# Vercel Deployment Guide

This document explains how to deploy the C.O.G.N.I.T. backend to Vercel using Gunicorn.

## Deployment Options

### Option 1: Serverless Functions (Default)

For standard serverless deployment on Vercel:

1. **Current Setup**: The `api/index.py` file is configured as a Vercel serverless function
2. **Configuration**: Uses `vercel.json` for routing and function settings
3. **Limitations**: Serverless functions don't use Gunicorn directly - they use Vercel's Python runtime

**To Deploy:**
```bash
# From the backend directory
vercel --prod
```

### Option 2: Container Deployment with Gunicorn (Recommended for Production)

For full Gunicorn support in production, use container deployment:

1. **Prerequisites**: Vercel account with container deployment enabled
2. **Configuration**: Uses the existing `Dockerfile` with Gunicorn configuration
3. **Benefits**: Full Gunicorn control, workers, threads, and production-grade performance

**To Deploy:**

1. Rename `vercel-container.json` to `vercel.json`:
```bash
mv vercel-container.json vercel.json
```

2. Remove or rename the `api/` directory to avoid conflicts:
```bash
mv api api.serverless-backup
```

3. Deploy to Vercel:
```bash
vercel --prod
```

## Gunicorn Configuration

The Gunicorn configuration is already set up in the following files:

### Dockerfile
```dockerfile
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "--log-level", "info", "--access-logformat", "%(m)s %(U)s %(s)s %(L)ss", "app:app"]
```

### Procfile (for Heroku/other PaaS)
```
web: gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile - --log-level info --access-logformat '%(m)s %(U)s %(s)s %(L)ss' app:app
```

## Recommended Gunicorn Settings for Production

- **Workers**: 2-4 (based on CPU cores)
- **Threads**: 4-8 per worker
- **Worker Class**: `sync` (default) or `gevent` for async
- **Timeout**: 60 seconds
- **Keepalive**: 2-5 seconds
- **Max Requests**: 1000-10000 (for worker recycling)
- **Max Requests Jitter**: 50-100

## Environment Variables

Ensure these environment variables are set in Vercel:

- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - Flask secret key
- `RAZORPAY_KEY_ID` - Razorpay API key
- `RAZORPAY_KEY_SECRET` - Razorpay secret
- `RAZORPAY_WEBHOOK_SECRET` - Razorpay webhook secret
- `WEBSITE_URL` - Your production website URL
- `CORS_ORIGINS` - Comma-separated list of allowed origins (optional)
- `REDIS_URL` - Redis connection string for rate limiting (optional, falls back to memory)
- `MIN_WORD_COUNT` - Minimum word count for submissions (default: 60)
- `TOO_FAST_SECONDS` - Flag submissions faster than this (default: 5)
- `IP_HASH_SALT` - Salt for IP hashing (default: local-salt)

## Performance Tuning

### For High Traffic:
- Increase workers to 4-8
- Use `gevent` worker class for async handling
- Enable Redis for rate limiting
- Increase database connection pool size

### For Low Traffic/Cost Optimization:
- Use 1-2 workers
- Keep thread count moderate (4)
- Consider using Vercel's serverless functions instead of containers

## Monitoring

The application includes:
- Performance tracking via `@track_performance` decorator
- Rate limiting with configurable storage (Redis/memory)
- Audit logging in database
- Security headers and CSP

## Troubleshooting

### Container Deployment Issues:
- Check Dockerfile syntax
- Ensure all dependencies are in `requirements.txt`
- Verify port binding (default: 5000)

### Serverless Function Issues:
- Check `api/index.py` handler
- Verify `vercel.json` routing configuration
- Check function timeout (maxDuration: 60)

### Database Connection Issues:
- Verify `DATABASE_URL` format (use `postgresql://` not `postgres://`)
- Check database accessibility from Vercel
- Verify connection pool settings in `app.py`
