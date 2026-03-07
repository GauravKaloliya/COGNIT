# Integration Playbook

## Client Architecture
- Keep route handlers thin and explicit.
- Normalize backend errors into product-level UX states.
- Persist payment/session state only as UX cache, not source of truth.

## Retry Strategy
- Retry transient `SYS_*` and `RATE_*` with backoff.
- Never retry validation failures without payload change.
- For payment state issues, refresh `GET /payments/{payment_public_id}/status`.

## Observability
- Correlate logs with `X-Request-ID`.
- Capture endpoint, idempotency key, and error code for failed calls.
- Alert on spikes in `PAY_*`, `FRAUD_*`, and `AUTH_*` categories.
