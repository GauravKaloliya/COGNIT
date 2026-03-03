# C.O.G.N.I.T. Frontend - Vercel Deployment Guide

## Quick Deploy

Click the button below to deploy directly to Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/cognit)

## Manual Deployment

### 1. Prerequisites

- Node.js 18+ installed locally
- A Vercel account
- Backend API deployed (if separate from frontend)

### 2. Environment Variables

Set these in your Vercel project settings:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_BASE` | Yes* | Backend API URL | `https://api.cognit.online` or empty for same origin |

*Required if deploying frontend and backend separately

### 3. Build Settings

Vercel should auto-detect these settings:

- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

### 4. Deployment Steps

```bash
# Install Vercel CLI (optional)
npm i -g vercel

# Deploy
vercel

# Or for production
vercel --prod
```

## Configuration Files

### vercel.json
- Handles SPA routing (all routes → index.html)
- Sets security headers
- Configures asset caching

### vite.config.js
- Code splitting for optimal loading
- Terser minification for production
- Console/debugger removal in production

## Security Headers

The following security headers are configured:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera()`

## Troubleshooting

### Build fails with "terser not found"
Run: `npm install -D terser`

### API calls failing in production
Check `VITE_API_BASE` is set correctly in Vercel environment variables.

### 404 errors on page refresh
Ensure `vercel.json` has the rewrite rules configured (should be automatic).

## Performance Optimizations

- JavaScript code splitting (vendor, charts, app)
- CSS minification
- Asset hashing for cache busting
- Gzip compression
- Immutable asset caching

## Post-Deployment Checklist

- [ ] Site loads without errors
- [ ] API calls work correctly
- [ ] All routes accessible (direct navigation)
- [ ] Dark mode works
- [ ] Payment flow works
- [ ] Survey submission works
- [ ] No console errors in production
