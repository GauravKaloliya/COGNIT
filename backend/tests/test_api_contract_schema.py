import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as main_module


def test_openapi_contract_file_is_valid_json():
    path = Path(__file__).resolve().parents[2] / "shared" / "contracts" / "openapi.v1.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["openapi"].startswith("3.")
    assert isinstance(data.get("paths"), dict)
    assert data["paths"], "paths cannot be empty"


def test_openapi_paths_are_exposed_by_app_routes():
    path = Path(__file__).resolve().parents[2] / "shared" / "contracts" / "openapi.v1.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    app_paths = {rule.rule for rule in main_module.app.url_map.iter_rules()}

    missing = []
    for raw_path in contract.get("paths", {}).keys():
        flask_path = raw_path.replace("{payment_public_id}", "<payment_public_id>")
        if flask_path not in app_paths:
            missing.append(raw_path)

    assert not missing, f"Contract paths missing in app routes: {missing}"


def test_error_contract_has_required_fields():
    path = Path(__file__).resolve().parents[2] / "shared" / "contracts" / "error_contract.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(contract, dict) and contract
    for key, value in contract.items():
        assert isinstance(value, dict), f"{key} must map to object"
        for field in ("code", "message", "status", "category"):
            assert field in value, f"{key} missing '{field}'"
