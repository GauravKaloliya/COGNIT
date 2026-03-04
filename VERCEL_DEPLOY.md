# Vercel Production Deployment

## 1) Deploy As Two Vercel Projects

- `frontend/` as a Vite static project.
- `backend/` as a Python serverless project.

## 2) Frontend Vercel Settings

- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`

Required env vars:

- `VITE_API_BASE=https://<your-backend-domain>`
- Any `VITE_*` runtime vars from `frontend/.env.example` you want to override.

## 3) Backend Vercel Settings

- Root Directory: `backend`
- Framework Preset: Other

Required env vars:

- `DATABASE_URL`
- `SECRET_KEY`
- `IP_HASH_SALT`
- `UPI_VPA`
- `UPI_NAME`
- `PAYMENT_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`
- `CORS_ORIGINS` (set to frontend URL, comma-separated if multiple)

Recommended:

- `RATELIMIT_STORAGE_URI` (Redis/Upstash in production)
- `DOCS_BASE_URL=https://<your-backend-domain>`

## 4) DNS / Domain

- Point frontend custom domain to frontend Vercel project.
- Point backend custom domain (e.g. `api.example.com`) to backend Vercel project.
- Update frontend `VITE_API_BASE` to backend domain.

## 5) Post-Deploy Checks

- `GET /health` returns healthy.
- Frontend can create participant, record consent, create payment, and submit survey.
- CORS works from frontend origin only.
- Security headers present on both frontend and backend responses.
