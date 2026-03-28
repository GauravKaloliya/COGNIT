# Backend

Flask backend for the C.O.G.N.I.T. participant workflow. It handles participant registration, consent, session recovery, email OTP verification, image delivery, survey submission, observability, and API docs.

## Main Responsibilities

- Participant onboarding and availability checks
- Consent capture and session continuity
- Email OTP request and verification
- Random survey and attention-check image delivery
- Submission validation, persistence, and audit logging
- Health checks, client error intake, and documentation routes

## Important Routes

- `GET /health`
- `GET /participant-options`
- `GET /participants/session`
- `POST /participants`
- `GET /check-username`
- `GET /check-email`
- `POST /consent`
- `POST /email-otp/request`
- `POST /email-otp/verify`
- `GET /images/random`
- `POST /submit`
- `POST /client-error`

## Config

Environment variables are documented in `backend/.env.example`.

Boot requirements:

- `DATABASE_URL`
- `WEBSITE_URL`
- `SECRET_KEY`
- `IP_HASH_SALT`
- `EMAIL_OTP_WEBHOOK_URL`
- `EMAIL_OTP_JWT_SECRET`

Optional production tuning includes:

- `RATELIMIT_STORAGE_URI`
- `DB_POOL_SIZE`
- `DB_MAX_OVERFLOW`
- `DB_POOL_TIMEOUT_SECONDS`
- `DB_POOL_RECYCLE_SECONDS`
- `APP_PROCESS_ROLE`
- `ENABLE_REQUEST_DB_OBSERVABILITY`

## Run Locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py
```
