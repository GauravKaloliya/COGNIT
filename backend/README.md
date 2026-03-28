# Backend

Implements the participant lifecycle APIs for C.O.G.N.I.T., including consent, participant registration, email OTP verification, image delivery, and survey submission.

## Current Scope
- Participant onboarding and consent
- Email OTP verification
- Image selection for survey and attention checks
- Submission quality processing and attention evaluation
- Audit-grade observability for participant and submission flows

## Architecture
- `app/routes/participant.py`: participant creation, consent, username/email checks, OTP flows
- `app/routes/image.py`: random image selection
- `app/routes/submission.py`: submission validation and persistence
- `app/services/image_service.py`: image/query orchestration
- `app/services/submission_service.py`: submission persistence and audit handling
- `app/utils/`: shared helpers, decorators, runtime, observability

## Production Notes
- Web instances should run with `APP_PROCESS_ROLE=web` so they do not start the durable queue worker.
- Dedicated background workers can run with `APP_PROCESS_ROLE=worker` when durable queue processing is needed.
- Request-level DB observability writes can be disabled with `ENABLE_REQUEST_DB_OBSERVABILITY=false` to avoid hammering hosted Postgres on every request.
- On Vercel-style deployments, the backend now defaults to smaller SQLAlchemy pool settings and disables request-level DB observability writes by default.

## Key Tables
- `participants`
- `participant_consents`
- `images`
- `attention_checks`
- `submissions`
- `audit_log`

## Primary Endpoints
- `GET /health`
- `POST /participants`
- `GET /check-username`
- `GET /check-email`
- `POST /consent`
- `GET /participant-options`
- `GET /participants/session`
- `POST /email-otp/request`
- `POST /email-otp/verify`
- `GET /images/random`
- `POST /submit`
