"""Canonical backend error-key constants.

This module auto-exports one constant per key from ``ERROR_CODES_TEMPLATE``:
``AUTH_EMAIL_OTP_SEND_TIMEOUT = "AUTH_EMAIL_OTP_SEND_TIMEOUT"``, etc.
Keeping this generated from the catalog prevents key drift.
"""

from __future__ import annotations

from app.constants.error_codes import ERROR_CODES_TEMPLATE

ERROR_KEYS = tuple(sorted(str(key) for key in ERROR_CODES_TEMPLATE.keys()))

for _key in ERROR_KEYS:
    globals()[_key] = _key

__all__ = ["ERROR_KEYS", *ERROR_KEYS]
