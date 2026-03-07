# Endpoint Design Notes

## Participant
- `/participants` handles identity uniqueness and session creation.
- `/consent` is explicit and auditable.

## Payment
- `/payments/create` returns lightweight session metadata and token.
- `/payments/{id}/qr` is separate to keep create-path lean.
- `/payments/{id}/upload-url` + `/verify-upload` split upload and verification concerns.

## Survey
- `/images/random` supports exclusion and attention scheduling.
- `/submit` handles quality checks, attention checks, and telemetry capture.

## Contracts
- Keep `shared/contracts/openapi.v1.json` and Postman collection aligned with live routes.
