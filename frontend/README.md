# C.O.G.N.I.T. Frontend

Production-grade React frontend for the C.O.G.N.I.T. research workflow.  
This app handles participant onboarding, payment-gated survey access, resilient UX state, and mobile-first interaction quality.

---

## What This Frontend Solves

- Guides users through a strict stage flow: `consent -> user-details -> payment-content -> payment-link -> survey -> survey-feedback -> finished`.
- Keeps UX resilient under refresh, reconnect, back navigation, and intermittent API failures.
- Preserves critical in-tab state with schema versioning and expiry.
- Prevents fragile transitions using guard hooks and server truth checks.
- Delivers mobile-first behavior with dedicated payment UX differences for mobile vs desktop.

---

## Tech Stack

- React 18
- Vite 5
- React Router 6
- Vanilla CSS design system (`src/styles.css`)
- ESLint (`eslint-plugin-react`, `eslint-plugin-react-hooks`)
- Playwright (E2E specs)

---

## Architecture Overview

```text
src/
  main.jsx                 # React bootstrap
  MainApp.jsx              # Router shell, global error boundary wiring
  App.jsx                  # Stage orchestration, persistent UX state, toasts
  pages/                   # Flow pages (consent/payment/survey/etc.)
  components/              # Reusable UI blocks and error/skeleton pages
  hooks/                   # useSystemHealth/usePaymentFlow/useSurveyFlow/useNavigationBlocker
  utils/                   # API client, base URL builder, error registry, UI text
  config/runtime.js        # env-driven runtime constants
  styles.css               # mobile-first global style system
```

---

## Key Engineering Features

- Stage-safe flow orchestration in `App.jsx` with guarded transitions.
- API envelope-aware client parser in `src/utils/api.js`.
- Automatic idempotency key injection for mutating requests.
- AbortController-based cancellation to prevent stale async updates.
- Offline/online health-aware UX via `useSystemHealth`.
- Multi-tab ownership lock to reduce conflicting writes.
- Refresh-proof state restore with schema version + TTL semantics.
- Mobile-specific payment behavior: mobile uses UPI deep-link call-to-action, desktop uses QR-led payment UX.
- Consistent error UI, skeleton states, and fallback screens.

---

## Endpoints Used by Frontend

- `GET /health`
- `POST /participants`
- `GET /check-username`
- `GET /check-email`
- `GET /check-phone`
- `POST /consent`
- `GET /participants/{public_id}/payment-status`
- `POST /payments/create`
- `GET /payments/{payment_id}/status`
- `POST /payments/{payment_id}/verify-upload`
- `GET /images/random`
- `POST /submit`
- `POST /engagement/track`

---

## Environment Configuration

Frontend is fully runtime-configurable via `VITE_*` variables consumed in `src/config/runtime.js`.

Start with:

```bash
cp .env.example .env.local
```

Required:
- `VITE_API_BASE`

High-impact optional knobs:
- `VITE_MAX_UPLOAD_MB`
- `VITE_PAYMENT_UPLOAD_MAX_MB`
- `VITE_MIN_SCREENSHOT_WIDTH`
- `VITE_MIN_SCREENSHOT_HEIGHT`
- `VITE_MIN_LAPLACIAN_VARIANCE`
- `VITE_UI_STATE_TTL_MS`
- `VITE_HEALTH_CHECK_INTERVAL_MS`
- `VITE_DISABLE_COPY_PASTE`

---

## Local Development

Install and run:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Preview build:

```bash
npm run preview
```

Lint:

```bash
npm run lint
```

E2E:

```bash
npm run e2e
```

---

## Mobile Compatibility Notes

- Layout and components are mobile-first by design.
- Touch-target sizes are explicitly tuned.
- State/status chips and page actions are responsive across small breakpoints.
- Sticky action patterns are used where long-scroll completion risk exists.

---

## Production Deployment

This frontend is designed for Vercel static deployment.

- Config file: `vercel.json`
- Build command: `npm run build`
- Output: `dist/`

Set production env in Vercel:
- `VITE_API_BASE=https://<your-backend-domain>`

---

## Resume-Ready Contribution Signals

- Built a robust multi-stage UX with backend-compatible transition guards.
- Implemented refresh-safe and reconnect-safe client state restoration.
- Added consistent API error handling contract and idempotent mutation support.
- Delivered mobile-first payment and survey experiences with production fallback behavior.
