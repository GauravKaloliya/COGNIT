#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

openapi_path = ROOT / "shared" / "contracts" / "openapi.v1.json"
error_path = ROOT / "shared" / "contracts" / "error_contract.json"

openapi = json.loads(openapi_path.read_text(encoding="utf-8"))
errors = json.loads(error_path.read_text(encoding="utf-8"))

assert openapi.get("openapi", "").startswith("3."), "openapi version must be 3.x"
assert isinstance(openapi.get("paths"), dict) and openapi["paths"], "openapi paths required"
assert isinstance(errors, dict) and errors, "error contract cannot be empty"

for key, val in errors.items():
    if not isinstance(val, dict):
        raise AssertionError(f"{key}: contract entry must be object")
    for req in ("code", "message", "status", "category"):
        if req not in val:
            raise AssertionError(f"{key}: missing {req}")

print(f"Contract validation passed: {len(openapi['paths'])} paths, {len(errors)} error entries")
