# C.O.G.N.I.T. Backend

Production-oriented Flask backend for the C.O.G.N.I.T. platform.  
Implements participant lifecycle APIs, payment verification pipeline, anti-fraud controls, submission quality processing, and audit-grade observability.

---

## What This Backend Solves

- Securely gates survey access behind verified payment.
- Verifies payment screenshots with OCR + fraud scoring.
- Prevents duplicate or replayed writes using idempotency keys.
- Maintains state consistency with explicit transition guards.
- Persists audit and performance signals for operational reliability.
- Supports priority/reward eligibility based on quality and behavior constraints.

---

## Stack

- Python 3.11+
- Flask 3
- SQLAlchemy 2
- PostgreSQL (Neon-compatible)
- Flask-Limiter
- Flask-CORS
- AWS S3 (payment file storage)
- AWS Textract (OCR)

---

## Backend Architecture

```text
main.py
  -> app/routes/              # thin HTTP handlers
  -> app/services/            # business logic + workflow/state services
  -> app/utils/               # OCR, fraud, helpers, decorators, security
  -> middleware/              # device fingerprint + payment-session guards
  -> schema.sql               # canonical DB schema
```

Service layer highlights:
- `payment_verify_service.py`: screenshot verification orchestration and fraud decisioning.
- `payment_service.py`: payment attempt/file metadata persistence.
- `submission_service.py`: submission normalization and behavior scoring helpers.
- `state_machine_service.py`: explicit transition map and guard checks.
- `idempotency_service.py`: replay-safe write protection.
- `reward_service.py`: priority qualification and reward selection logic.
- `domain_event_service.py`: structured domain event emission to audit logs.

---

## API Design Principles

- Strict JSON response envelope. Success shape: `{ "success": true, "data": ... }`. Error shape: `{ "success": false, "error": { code, message, ... } }`.
- Request correlation with `X-Request-ID`.
- Idempotency key support on mutating routes.
- Per-route rate limits.
- Centralized error code registry in `app/config.py`.

---

## End-User API Surface

- `GET /health`
- `POST /participants`
- `GET /check-username`
- `GET /check-email`
- `GET /check-phone`
- `POST /consent`
- `GET /participants/{public_id}/payment-status`
- `POST /payments/create`
- `GET /payments/{payment_id}/status`
- `POST /payments/{payment_id}/verify-upload`
- `GET /images/random`
- `POST /submit`

Docs endpoints:
- `GET /` (interactive API docs page)
- `GET /docs` (JSON docs)

---

## Data Model Overview

Canonical schema file: `schema.sql`.

Primary entities:
- Participants: `participants`
- Survey assets: `images`, `attention_checks`
- Responses: `submissions`, `attention_events`
- Participant stats: `participant_attention_stats`, `participant_activity_stats`
- Priority/reward: `priority_participants`, `reward_winners`
- Payments: `payments`, `payment_files`, `payment_upload_attempts`, `payment_fraud_signals`, `payment_submissions`
- Security/audit: `device_fingerprints`, `audit_log`, `payment_audit_log`
- Reliability: `idempotency_keys`, `performance_metrics`

Schema behavior includes:
- Triggered consistency updates.
- Transition validation rules.
- Append-only protections for sensitive event tables.

---

## Fraud & Verification Pipeline

Payment verification applies multiple checks:
- File-level validation (size/type/decoding)
- OCR extraction and confidence handling
- UPI app detection + transaction content checks
- Duplicate hash detection
- Near-duplicate perceptual hash detection
- Rejected screenshot reuse detection
- Fingerprint overlap checks for identity-risk logic
- Weighted fraud score evaluation with policy thresholds

Decision artifacts are persisted into payment attempts, payment metadata, fraud signals, and audit logs.

---

## Local Setup

Create environment and install:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Required env keys:
- `DATABASE_URL`
- `UPI_VPA`
- `UPI_NAME`
- `PAYMENT_SECRET`
- `SECRET_KEY`
- `IP_HASH_SALT`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`

Initialize database:

```bash
psql "$DATABASE_URL" -f schema.sql
psql "$DATABASE_URL" -f seed_images.sql
```

Run server:

```bash
python main.py
```

Default local URL:
- `http://localhost:5000`

---

## Operations & Observability

- Request/response logging with correlation IDs.
- Audit logging for participant and payment flows.
- Domain event emission for major workflow events.
- Sampled performance metric writes with endpoint latency and payload sizing.
- Health endpoint with short-lived cache to reduce DB load.

---

## Deployment

Backend is prepared for Vercel Python serverless deployment.

- Entrypoint: `api/index.py`
- Config: `vercel.json`

Production recommendations:
- Managed PostgreSQL (Neon-compatible)
- Upstash Redis for distributed rate limiting
- AWS S3 + Textract credentials via environment variables
- Tight `CORS_ORIGINS` to frontend domains only

---

## Contribution Signals

- Designed a service-oriented Flask backend with state-machine guarded workflows.
- Built OCR + fraud-scored payment verification with duplicate and near-duplicate protection.
- Implemented idempotent write semantics and strict API error contracts.
- Delivered audit/performance instrumentation suitable for production operations.
