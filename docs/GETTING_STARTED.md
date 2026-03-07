# Getting Started

## Prerequisites
- Backend running and reachable
- `base_url` configured in client
- Idempotency key generator on client

## Happy Path
1. `POST /participants`
2. `POST /consent`
3. `POST /payments/create`
4. `POST /payments/{payment_public_id}/upload-url`
5. `POST /payments/{payment_public_id}/verify-upload`
6. `GET /images/random`
7. `POST /submit`

## Integration Guardrails
- Always log and store `X-Request-ID`.
- Retry only when `error.retryable=true`.
- Keep payment/token state server-authoritative.
