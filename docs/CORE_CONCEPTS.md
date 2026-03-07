# Core Concepts

## Envelope Contract
- Success: `{ "success": true, "data": ... }`
- Error: `{ "success": false, "error": { code, message, category, ... } }`

## Idempotency
- Use `X-Idempotency-Key` on mutating routes.
- Same key + same request hash returns replay-safe response.

## Payment Write Token
- Issued by payment create/status routes.
- Required for upload-url and verify-upload routes.
- Bound to payment, participant, nonce, and expiry claims.

## Survey Telemetry
- Survey-only telemetry persisted via submission fields (`survey_*`).
- Non-survey engagement API surface is not used.
