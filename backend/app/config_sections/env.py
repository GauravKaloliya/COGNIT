"""Shared environment loading and parsing helpers for config sections."""

from __future__ import annotations

import os
from pathlib import Path


def load_candidate_env_files() -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    candidate_env_files = [
        backend_dir / ".env",
        backend_dir / ".env.development",
        backend_dir / ".env.local",
    ]
    try:
        from dotenv import load_dotenv

        for env_path in candidate_env_files:
            if env_path.exists():
                load_dotenv(env_path)
                break
        return
    except ImportError:
        pass

    for env_path in candidate_env_files:
        if not env_path.exists():
            continue
        with env_path.open("r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        break


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        raise ValueError(f"{name} is required")
    return value


def required_int_env(name: str) -> int:
    return int(required_env(name))


def required_float_env(name: str) -> float:
    return float(required_env(name))


def required_bool_env(name: str) -> bool:
    raw = required_env(name).strip().lower()
    if raw in {"true", "1", "yes", "on"}:
        return True
    if raw in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean value")


def bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return bool(default)
    raw = str(raw).strip().lower()
    if raw in {"true", "1", "yes", "on"}:
        return True
    if raw in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean value")


def int_env(name: str, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    raw = os.getenv(name)
    value = int(default if raw is None or str(raw).strip() == "" else raw)
    if min_value is not None and value < min_value:
        raise ValueError(f"{name} must be >= {min_value}")
    if max_value is not None and value > max_value:
        raise ValueError(f"{name} must be <= {max_value}")
    return value


def float_env(name: str, default: float, *, min_value: float | None = None, max_value: float | None = None) -> float:
    raw = os.getenv(name)
    value = float(default if raw is None or str(raw).strip() == "" else raw)
    if min_value is not None and value < min_value:
        raise ValueError(f"{name} must be >= {min_value}")
    if max_value is not None and value > max_value:
        raise ValueError(f"{name} must be <= {max_value}")
    return value


def str_env(name: str, default: str, *, allow_blank: bool = False, choices: set[str] | None = None) -> str:
    raw = os.getenv(name)
    value = str(default if raw is None else raw).strip()
    if not allow_blank and value == "":
        raise ValueError(f"{name} cannot be blank")
    if choices is not None and value not in choices:
        raise ValueError(f"{name} must be one of: {sorted(choices)}")
    return value


def validate_url(name: str, value: str) -> None:
    if not value:
        raise ValueError(f"{name} cannot be blank")
    if not (value.startswith("http://") or value.startswith("https://")):
        raise ValueError(f"{name} must start with http:// or https://")


# Load env files as soon as env helpers are imported so section modules
# can safely resolve required values at import time.
load_candidate_env_files()
