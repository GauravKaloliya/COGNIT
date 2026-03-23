"""Shared idempotency-domain constants."""

IDEMPOTENCY_CONFLICT_ERROR_CODE = "VAL_003_0009"
IDEMPOTENCY_CONFLICT_MESSAGE = "Idempotency key reuse with a different request payload is not allowed."
IDEMPOTENCY_DEFAULT_STATUS = "processed"
LOG_IDEMPOTENCY_CONFLICT = "idempotency_conflict endpoint=%s key=%s participant=%s"
