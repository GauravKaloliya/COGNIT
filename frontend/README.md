# Frontend

React + Vite frontend for the C.O.G.N.I.T. participant journey.

## User Journey

`consent -> user details -> email OTP -> survey -> done`

## Highlights

- Mobile-first onboarding and survey flow
- Session recovery and draft persistence
- Client-side validation aligned with backend limits
- Offline, retry, and service health handling
- Turnstile support via runtime env flags

## Local Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Useful commands:

```bash
npm run lint
npm run build
```
