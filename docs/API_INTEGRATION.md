# API Integration (Frontend-Agnostic)

This API is protocol-first: any client (web, mobile, Postman, server-to-server) can integrate.

## Required Headers for Write Endpoints

- `X-Idempotency-Key`: required on mutating endpoints (`POST /participants`, `POST /payments/create`, `POST /payments/{id}/verify-upload`, `POST /submit`)
- `Authorization: Bearer <payment_token>`: required for payment write flow endpoints.

## Core Flow

1. `POST /participants` to register user.
2. `POST /consent` to record consent.
3. `POST /payments/create` to start payment session.
4. `GET /payments/{payment_public_id}/status` to fetch latest status/token.
5. `POST /payments/{payment_public_id}/verify-upload` to verify screenshot.
6. `GET /images/random` and `POST /submit` for survey workflow.

## Error Contract

Shared error contract is defined in:

- `shared/contracts/error_contract.json`

## OpenAPI Contract

API contract is defined in:

- `shared/contracts/openapi.v1.json`
