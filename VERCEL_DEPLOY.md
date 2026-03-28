# Vercel Deployment

Deploy the repo as two Vercel projects:

- `frontend/` as the Vite app
- `backend/` as the Python API

## Frontend Project

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`

Recommended env:

- `VITE_API_BASE=https://<backend-domain>`
- `VITE_TURNSTILE_ENABLED=true`
- `VITE_TURNSTILE_SITE_KEY=<your-site-key>`

## Backend Project

- Root directory: `backend`
- Framework preset: `Other`

Required env:

- `DATABASE_URL`
- `WEBSITE_URL`
- `SECRET_KEY`
- `IP_HASH_SALT`
- `EMAIL_OTP_WEBHOOK_URL`
- `EMAIL_OTP_JWT_SECRET`

Recommended env:

- `DOCS_BASE_URL=https://<backend-domain>`
- `CORS_ORIGINS=https://<frontend-domain>`
- `RATELIMIT_STORAGE_URI=redis://...`
- `TURNSTILE_ENABLED=true`
- `TURNSTILE_SECRET_KEY=<your-secret>`
- `APP_PROCESS_ROLE=web`

## Post-Deploy Checks

- `GET /health` responds successfully.
- Frontend can create a participant and submit consent.
- OTP request and verify flow succeeds.
- Survey loads images and submits successfully.
- Frontend origin is allowed by CORS.
