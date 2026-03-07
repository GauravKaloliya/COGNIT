import base64
import hashlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from flask import Flask, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as main_module
from app import config as config_module
from app.routes import payment as payment_routes
from app.services import payment_verify_service
import middleware.payment_flow as payment_flow_module
from middleware.payment_flow import require_valid_payment_session


class _Result:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row

    def scalar(self):
        if self._row is None:
            return None
        if isinstance(self._row, tuple):
            return self._row[0]
        return self._row


class _FakeDb:
    def __init__(self, session_row=None):
        self.session_row = session_row
        self.executed = []
        self.commits = 0

    def execute(self, query, params=None):
        sql = str(query)
        self.executed.append((sql, params or {}))
        if "SELECT p.status, p.expires_at, p.participant_id, p.signature" in sql:
            return _Result(self.session_row)
        return _Result()

    def commit(self):
        self.commits += 1

    def close(self):
        return None


def _make_guarded_app():
    app = Flask("guarded-test")
    app.config["TESTING"] = True

    @app.route("/payments/<payment_public_id>/upload", methods=["POST"])
    @require_valid_payment_session
    def upload_action(payment_public_id):
        return jsonify({"ok": True, "payment_id": payment_public_id})

    return app


def test_expired_or_invalid_payment_token_rejected(monkeypatch):
    app = _make_guarded_app()
    fake_db = _FakeDb(
        session_row=(
            "pending",
            datetime.now(timezone.utc) + timedelta(minutes=5),
            7,
            "sig-abc",
            "sess-1",
            {"payment_write_nonce": "n1"},
        )
    )

    monkeypatch.setattr(payment_flow_module, "verify_payment_write_token", lambda _token: None)
    monkeypatch.setattr("app.database.get_db", lambda: fake_db)

    resp = app.test_client().post(
        "/payments/pay-1/upload",
        json={},
        headers={"Authorization": "Bearer stale-or-replayed"},
    )

    assert resp.status_code == 403
    assert resp.get_json()["error"]["code"] == "AUTH_002_0002"


def test_nonce_reuse_blocked_by_payment_middleware(monkeypatch):
    app = _make_guarded_app()
    fake_db = _FakeDb(
        session_row=(
            "pending",
            datetime.now(timezone.utc) + timedelta(minutes=5),
            7,
            "sig-abc",
            "sess-1",
            {"payment_write_nonce": "server-nonce-new"},
        )
    )

    claims = {
        "sub": "pay-1",
        "pid": 7,
        "sig": "sig-abc",
        "sid": "sess-1",
        "nonce": "old-replayed-nonce",
        "dfp": "",
    }
    monkeypatch.setattr(payment_flow_module, "verify_payment_write_token", lambda _token: claims)
    monkeypatch.setattr("app.database.get_db", lambda: fake_db)

    resp = app.test_client().post(
        "/payments/pay-1/upload",
        json={},
        headers={"Authorization": "Bearer valid-but-old"},
    )

    assert resp.status_code == 403
    assert resp.get_json()["error"]["code"] == "AUTH_002_0002"


def test_expired_payment_session_is_marked_and_rejected(monkeypatch):
    app = _make_guarded_app()
    fake_db = _FakeDb(
        session_row=(
            "pending",
            datetime.now(timezone.utc) - timedelta(seconds=1),
            7,
            "sig-abc",
            "sess-1",
            {"payment_write_nonce": "n1"},
        )
    )

    claims = {"sub": "pay-1", "pid": 7, "sig": "sig-abc", "sid": "sess-1", "nonce": "n1", "dfp": ""}
    monkeypatch.setattr(payment_flow_module, "verify_payment_write_token", lambda _token: claims)
    monkeypatch.setattr("app.database.get_db", lambda: fake_db)

    resp = app.test_client().post(
        "/payments/pay-1/upload",
        json={},
        headers={"Authorization": "Bearer valid"},
    )

    assert resp.status_code == 410
    assert resp.get_json()["error"]["code"] == "PAY_001_0001"
    assert any("SET status = 'expired'" in sql for sql, _ in fake_db.executed)
    assert fake_db.commits >= 1


def test_verify_attempt_lockout_returns_specific_error(monkeypatch):
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9xjKsAAAAASUVORK5CYII="
    )
    sha256_hex = hashlib.sha256(png_bytes).hexdigest()

    class _FakeDbForLockout:
        def __init__(self):
            self.executed = []
            self.commits = 0

        def execute(self, query, params=None):
            sql = str(query)
            self.executed.append((sql, params or {}))
            if "SELECT id, participant_id, status, expires_at, timer_activated_at, verification_attempts" in sql:
                return _Result(
                    (
                        101,
                        5,
                        "pending",
                        datetime.now(timezone.utc) + timedelta(minutes=5),
                        datetime.now(timezone.utc),
                        int(config_module.PAYMENT_VERIFY_MAX_ATTEMPTS),
                    )
                )
            return _Result()

        def commit(self):
            self.commits += 1

    db = _FakeDbForLockout()
    monkeypatch.setattr(payment_verify_service, "validate_image_extension", lambda _filename: (True, "png", "image/png"))
    monkeypatch.setattr(payment_verify_service, "load_idempotent_response", lambda *_args, **_kwargs: (None, None))
    monkeypatch.setattr(payment_verify_service, "create_payment_upload_attempt", lambda *_args, **_kwargs: 222)
    monkeypatch.setattr(payment_verify_service, "finalize_payment_upload_attempt", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(payment_verify_service, "ensure_payment_status_transition", lambda *_args, **_kwargs: None)

    app = Flask("verify-lockout-test")
    app.config["TESTING"] = True
    with app.app_context():
        response, status = payment_verify_service.process_verify_upload(
            db=db,
            payment_public_id="pay-lock",
            data={
                "image_base64": base64.b64encode(png_bytes).decode("ascii"),
                "sha256": sha256_hex,
                "file_extension": "png",
            },
            request_id="req-1",
            device_fingerprint="dfp-1",
            idempotency_key_header="idem-1",
            user_agent="pytest",
            ip_hash="x" * 64,
            payment_audit_logger=None,
        )

    assert status == 409
    assert response.get_json()["error"]["code"] == "PAY_001_0008"
    assert any("SET status = :to_status" in sql for sql, _ in db.executed)
    assert db.commits >= 1


def test_turnstile_failure_blocks_payment_create(monkeypatch):
    fake_db = _FakeDb()

    monkeypatch.setattr(main_module, "get_db", lambda: fake_db)
    monkeypatch.setattr(payment_routes, "get_db", lambda: fake_db)
    monkeypatch.setattr(payment_routes, "resolve_participant_id", lambda _db, _public_id: 11)
    monkeypatch.setattr(payment_routes, "verify_turnstile_token", lambda _token, _ip=None: (False, {"success": False}))

    client = main_module.app.test_client()
    resp = client.post(
        "/payments/create",
        json={"public_id": "pub-1", "amount": 1, "turnstile_token": "bad-token"},
        headers={"X-Idempotency-Key": "idem-turnstile-test"},
    )

    assert resp.status_code == 403
    assert resp.get_json()["error"]["code"] == "BOT_001_0001"


def test_rate_limit_not_bypassed_by_header_changes():
    app = Flask("rate-limit-test")
    app.config["TESTING"] = True
    limiter = Limiter(app=app, key_func=get_remote_address, storage_uri="memory://")

    @app.route("/limited", methods=["POST"])
    @limiter.limit("2 per minute")
    def limited():
        return jsonify({"ok": True})

    client = app.test_client()

    ok1 = client.post("/limited", headers={"X-Request-ID": "a"}, environ_base={"REMOTE_ADDR": "10.0.0.1"})
    ok2 = client.post("/limited", headers={"X-Request-ID": "b"}, environ_base={"REMOTE_ADDR": "10.0.0.1"})
    blocked = client.post("/limited", headers={"X-Request-ID": "c"}, environ_base={"REMOTE_ADDR": "10.0.0.1"})
    other_ip_ok = client.post("/limited", headers={"X-Request-ID": "d"}, environ_base={"REMOTE_ADDR": "10.0.0.2"})

    assert ok1.status_code == 200
    assert ok2.status_code == 200
    assert blocked.status_code == 429
    assert other_ip_ok.status_code == 200


def test_invalid_rate_limit_config_fails_fast(monkeypatch):
    monkeypatch.setenv("TEST_RATE_LIMIT", "bad-format")
    with pytest.raises(ValueError, match="must match"):
        config_module._rate_limit_env("TEST_RATE_LIMIT", "30 per minute")
