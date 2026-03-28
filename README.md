# C.O.G.N.I.T.

C.O.G.N.I.T. is a full-stack research workflow app built around a guided participant journey:

`consent -> user details -> email OTP verification -> image survey -> completion`

The repository contains a React/Vite frontend and a Flask/PostgreSQL backend with session handling, anti-abuse controls, attention-aware survey logic, and API docs.

## Apps

- `frontend/`: participant-facing React app
- `backend/`: Flask API, config, persistence, and docs UI

## Current Flow

1. Participant reviews consent and starts a session.
2. Participant submits username, email, age, and location details.
3. Backend sends a one-time email code and verifies it.
4. Participant completes the image-based survey flow.
5. Backend stores the submission, attention signals, and audit events.

## Local Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Required backend values before boot:

- `DATABASE_URL`
- `WEBSITE_URL`
- `SECRET_KEY`
- `IP_HASH_SALT`
- `EMAIL_OTP_WEBHOOK_URL`
- `EMAIL_OTP_JWT_SECRET`

Initialize the database:

```bash
psql "$DATABASE_URL" -f schema.sql
psql "$DATABASE_URL" -f seed_images.sql
```

Start the backend:

```bash
python main.py
```

Backend defaults to `http://localhost:5000`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Start the frontend:

```bash
npm run dev
```

Frontend defaults to `http://localhost:5173`.

## Quality Checks

```bash
cd frontend
npm run lint
npm run build
```

```bash
cd backend
python -m py_compile main.py
```

## Deployment

Vercel deployment notes live in `VERCEL_DEPLOY.md`.
