# C.O.G.N.I.T.

**Cognitive Operations & Guided Narrative Intelligence Tool**  
Production-ready full-stack platform for image-based research workflows with secure payment verification, anti-fraud controls, quality-gated submissions, and mobile-first UX.

---

## TL;DR

C.O.G.N.I.T. solves a hard real-world workflow:

1. Onboard participant with validation and consent.
2. Create time-bound UPI payment session.
3. Verify screenshot using OCR + fraud scoring.
4. Unlock survey only after verified payment.
5. Score submission quality and survey behavior.
6. Auto-qualify high-quality participants for priority/reward pipelines.

This repo demonstrates **product thinking + systems engineering + secure backend design + resilient frontend UX**.

---

## Why This Stands Out

- Built a **stateful, multi-stage flow engine** across frontend + backend.
- Implemented **payment screenshot verification** using OCR extraction (Amazon Textract), duplicate hash checks, near-duplicate perceptual hash checks, rejected-reuse detection, and weighted fraud scoring + policy thresholds.
- Added **idempotency for mutating APIs** to prevent duplicate writes on retries/network jitter.
- Enforced **workflow transition guards** (payment/submission state machine).
- Designed **refresh-proof, reconnect-aware frontend** with offline/online behavior and storage TTL/versioning.
- Shipped **auditability** via domain events and structured logs.
- Included **priority queue + reward eligibility logic** based on quality and behavioral constraints.

---

## Project Summary

C.O.G.N.I.T. is a research-grade data collection platform where participant trust, anti-fraud protection, and data quality are all first-class. The system combines secure backend validation with a user-friendly frontend to keep completion rates high while minimizing low-quality or fraudulent submissions.

---

## Core Product Capabilities

### 1) Participant Lifecycle
- Participant creation with uniqueness checks (`username`, `email`)
- Consent recording with idempotency support
- Stage progression: `consent -> user-details -> payment -> survey -> finished`

### 2) Payment Verification System
- Payment session creation with signed payload and expiry
- Mobile UPI deep-link UX + desktop QR UX
- Screenshot upload with client checks (size/resolution/clarity) and server verification
- OCR + app detection + transaction rule checks
- Fraud pipeline with weighted reason scoring and reject thresholds

### 3) Submission Quality Pipeline
- Word/rating/feedback constraints
- Attention-check-aware submission processing
- Dynamic too-fast detection
- Quality score generation from linguistic + behavioral signals
- Engagement metrics persisted: tab switches, page close attempts, network disconnects

### 4) Priority & Rewards Layer
- Layer 1 eligibility gates (minimum words/rounds + no suspicious response patterns)
- Layer 2 selection using quality/time/feedback/rating criteria
- Inserts into `priority_participants` and `reward_winners`

### 5) Reliability & Security
- Strict API envelope (`success`, `data`, `error.code`, `error.message`)
- Request correlation with `X-Request-ID`
- Route-level rate limiting
- Audit logs + payment audit logs
- Security headers on frontend/backend deployments
- Schema-level constraints, triggers, and consistency guards

---

## Tech Stack

### Frontend
- React 18
- Vite 5
- React Router
- Mobile-first CSS system
- ESLint

### Backend
- Flask 3
- SQLAlchemy 2
- PostgreSQL (Neon-compatible)
- Flask-Limiter
- Flask-CORS
- Boto3 (S3 + Textract)
- Pillow / qrcode

### Infra / Deployment
- Vercel (split frontend/backend projects)
- AWS S3 for payment file storage
- Amazon Textract for OCR
- Redis/Upstash recommended for production rate-limit store

---

## Architecture (High Level)

```text
Frontend (React/Vite)
  -> API Client (idempotency keys + standardized error parsing)
  -> Backend (Flask)
       -> Route Layer (thin handlers)
       -> Service Layer (payment/submission/domain logic)
       -> Data Layer (SQLAlchemy + PostgreSQL)
       -> S3 (payment files)
       -> Textract (OCR)
```

---

## Repository Structure

```text
COGNIT/
  backend/
    app/
      routes/                  # HTTP route handlers
      services/                # business logic + workflow/state logic
      utils/                   # OCR/fraud/helpers/decorators/security
      static/                  # API docs styles
      config.py                # centralized env + error-code config
    middleware/                # payment flow + device fingerprint middleware
    templates/                 # docs UI
    schema.sql                 # canonical database schema
    seed_images.sql            # survey image seed dataset
    main.py                    # app bootstrap + health + docs

  frontend/
    src/
      pages/                   # stage pages (consent/payment/survey/etc.)
      components/              # reusable UI blocks
      hooks/                   # system, payment, survey flow hooks
      utils/                   # API wrapper + error registry + text map
      config/runtime.js        # frontend env/runtime constants
      styles.css               # global responsive design system
```

---

## End-User API Surface

Primary routes used by the app:

- `GET /health`
- `POST /participants`
- `GET /check-username`
- `GET /check-email`
- `POST /consent`
- `GET /participants/{public_id}/payment-status`
- `POST /payments/create`
- `GET /payments/{payment_id}/status`
- `POST /payments/{payment_id}/verify-upload`
- `GET /images/random`
- `POST /submit`

Docs:
- `GET /` interactive docs page

---

## Data Model Highlights

Major tables:
- `participants`, `images`, `attention_checks`, `submissions`, `attention_events`
- `participant_attention_stats`, `participant_activity_stats`, `priority_participants`
- `payments`, `payment_files`, `payment_upload_attempts`, `payment_fraud_signals`, `payment_submissions`
- `reward_winners`, `device_fingerprints`, `audit_log`, `payment_audit_log`, `idempotency_keys`, `performance_metrics`

Schema design includes:
- trigger-based consistency updates
- guarded payment status transitions
- submission/payment consistency constraints
- append-only attention event safeguards

---

## Quickstart (Local)

### 1) Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set required env keys in `backend/.env`:
- `DATABASE_URL`
- `UPI_VPA`
- `UPI_NAME`
- `PAYMENT_SECRET`
- `SECRET_KEY`
- `IP_HASH_SALT`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET_NAME`

Initialize DB:

```bash
psql "$DATABASE_URL" -f schema.sql
psql "$DATABASE_URL" -f seed_images.sql
```

Run backend:

```bash
python main.py
```

Backend URL: `http://localhost:5000`

### 2) Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Set:
- `VITE_API_BASE=http://localhost:5000`

Run frontend:

```bash
npm run dev
```

Frontend URL: `http://localhost:5173`

---

## Quality Commands

Frontend:

```bash
cd frontend
npm run lint
npm run build
npm run e2e
```

Backend syntax check:

```bash
cd backend
python -m py_compile main.py
```

---

## Deployment (Vercel)

Deploy as **two Vercel projects**:

1. `frontend/` (Vite static output)
2. `backend/` (Python serverless)

Reference files:
- `VERCEL_DEPLOY.md`
- `frontend/vercel.json`
- `backend/vercel.json`

Recommended production services:
- Postgres (Neon-compatible)
- Redis/Upstash for rate limiting
- AWS S3 + Textract for payment verification pipeline

---

## Environment-Driven Configuration

- Frontend runtime config is centralized in `frontend/src/config/runtime.js`.
- Backend env/config and standardized error registry are centralized in `backend/app/config.py`.

Template env files:
- `backend/.env.example`
- `frontend/.env.example`

---

## Engineering Decisions

- Kept backend as source of truth for critical transitions.
- Used service layer (`payment_service`, `payment_verify_service`, `submission_service`) to keep route handlers lean.
- Added domain event emission (`submission_saved`, `priority_qualified`, `reward_selected`) for traceability.
- Used storage schema versioning + expiry for resilient client-side flow restore.
- Guarded duplicate writes through idempotency on high-risk mutating routes.

---

## License

MIT. See `LICENSE`.
