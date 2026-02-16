# Gunicorn Setup for Vercel Production Deployment

## Summary of Changes

This setup enables the C.O.G.N.I.T. backend to be deployed to Vercel using Gunicorn for production-grade performance.

### New Files Created

1. **`gunicorn.conf.py`** - Production-optimized Gunicorn configuration file
   - Auto-calculates workers based on CPU cores
   - Configurable via environment variables
   - Includes hooks for lifecycle events (startup, shutdown, worker events)
   - Production-ready logging and monitoring

2. **`vercel-container.json`** - Vercel configuration for container deployment
   - Enables Docker-based deployment on Vercel
   - Allows full Gunicorn control

3. **`VERCEL_DEPLOYMENT.md`** - Comprehensive deployment guide
   - Detailed instructions for both serverless and container deployment
   - Troubleshooting tips
   - Performance tuning recommendations

4. **`deploy-vercel.sh`** - Automated deployment script
   - Interactive script to choose deployment type
   - Automatically backs up existing configurations
   - Validates environment before deployment

### Modified Files

1. **`Dockerfile`**
   - Added `curl` for health checks
   - Updated to use `gunicorn.conf.py` for configuration
   - Production-optimized Gunicorn settings with worker recycling

2. **`Procfile`**
   - Updated to use `gunicorn.conf.py` for consistency

3. **`vercel.json`**
   - Added function configuration (runtime, max duration)
   - Added routing rules for API requests
   - Optimized for serverless function deployment

4. **`api/index.py`**
   - Added proper handler function for Vercel
   - Improved documentation

5. **`.env.example`**
   - Added comprehensive Gunicorn environment variables
   - Documented all configuration options

## Deployment Options

### Option 1: Serverless Functions (Current Default)

- Uses `api/index.py` as Vercel serverless function
- Does NOT use Gunicorn directly (uses Vercel's Python runtime)
- Good for: Development, low traffic, cost optimization
- Configuration: `vercel.json`

**Deploy:**
```bash
cd backend
vercel --prod
```

### Option 2: Container Deployment with Gunicorn (Recommended for Production)

- Uses Docker with full Gunicorn configuration
- Production-grade performance with worker processes
- Good for: Production, high traffic, full control
- Configuration: `Dockerfile` + `gunicorn.conf.py`

**Deploy using script:**
```bash
cd backend
./deploy-vercel.sh
# Choose option 2 (Container Deployment)
```

**Deploy manually:**
```bash
cd backend
# Backup current config
mv vercel.json vercel.serverless-backup.json
# Use container config
cp vercel-container.json vercel.json
# Move API directory to avoid conflicts
mv api api.serverless-backup
# Deploy
vercel --prod
```

## Gunicorn Configuration

### Default Settings

- **Workers**: Auto-calculated (CPU cores × 2 + 1, minimum 2)
- **Threads**: 4 per worker
- **Worker Class**: `sync` (can be changed to `gevent`)
- **Timeout**: 60 seconds
- **Keepalive**: 5 seconds
- **Max Requests**: 1000 (worker recycling)
- **Log Level**: `info`

### Customizing Configuration

You can override any Gunicorn setting via environment variables:

```bash
# Example: Set 4 workers, 8 threads
export GUNICORN_WORKERS=4
export GUNICORN_THREADS=8

# Example: Use gevent worker class
export GUNICORN_WORKER_CLASS=gevent

# Example: Increase timeout
export GUNICORN_TIMEOUT=120
```

### Configuration File

All settings are managed in `gunicorn.conf.py`:

```python
# Key settings from gunicorn.conf.py
workers = int(os.getenv("GUNICORN_WORKERS", max(2, multiprocessing.cpu_count() * 2 + 1)))
threads = int(os.getenv("GUNICORN_THREADS", "4"))
worker_class = os.getenv("GUNICORN_WORKER_CLASS", "sync")
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
```

## Local Testing

### Test Gunicorn Configuration

```bash
cd backend

# Activate virtual environment
source .venv/bin/activate

# Run with Gunicorn using config file
gunicorn -c gunicorn.conf.py app:app
```

### Test with Custom Settings

```bash
# Test with 2 workers, 4 threads
GUNICORN_WORKERS=2 GUNICORN_THREADS=4 gunicorn -c gunicorn.conf.py app:app

# Test in development mode
GUNICORN_LOG_LEVEL=debug gunicorn -c gunicorn.conf.py --reload app:app
```

## Environment Variables for Vercel

Set these in your Vercel project settings:

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - Flask secret key

### Optional (Recommended for Production)
- `RAZORPAY_KEY_ID` - Razorpay API key
- `RAZORPAY_KEY_SECRET` - Razorpay secret
- `RAZORPAY_WEBHOOK_SECRET` - Razorpay webhook secret
- `WEBSITE_URL` - Your production website URL
- `REDIS_URL` - Redis for rate limiting

### Gunicorn-Specific (for Container Deployment)
- `GUNICORN_WORKERS` - Number of worker processes
- `GUNICORN_THREADS` - Threads per worker
- `GUNICORN_TIMEOUT` - Request timeout
- `GUNICORN_LOG_LEVEL` - Logging level

## Performance Tuning

### For High Traffic
```bash
GUNICORN_WORKERS=8
GUNICORN_THREADS=8
GUNICORN_WORKER_CLASS=gevent
```

### For Cost Optimization
```bash
GUNICORN_WORKERS=2
GUNICORN_THREADS=4
GUNICORN_WORKER_CLASS=sync
```

### For Long-Running Requests
```bash
GUNICORN_TIMEOUT=120
```

## Monitoring

The application includes built-in monitoring:

- Performance metrics logged to stdout/stderr
- Health check endpoint: `/api/health`
- Audit logging in database
- Rate limiting with configurable storage

View logs in Vercel Dashboard or using CLI:
```bash
vercel logs
```

## Troubleshooting

### Container Deployment Issues

**Issue**: "api directory conflict"
- Solution: Move or rename the `api/` directory before container deployment

**Issue**: "Workers not starting"
- Solution: Check `gunicorn.conf.py` configuration and environment variables
- Solution: Reduce `GUNICORN_WORKERS` if out of memory

**Issue**: "Database connection errors"
- Solution: Verify `DATABASE_URL` is set correctly
- Solution: Check database is accessible from Vercel

### Serverless Function Issues

**Issue**: "Timeout errors"
- Solution: Increase `maxDuration` in `vercel.json` (max 60s on Vercel)
- Solution: Optimize code for faster execution

**Issue**: "Import errors"
- Solution: Check `api/index.py` imports are correct
- Solution: Ensure all dependencies are in `requirements.txt`

## Reverting Changes

### To switch back to serverless from container:
```bash
cd backend
mv api.serverless-backup api
cp vercel.serverless-backup.json vercel.json
vercel --prod
```

### To switch back to container from serverless:
```bash
cd backend
mv api api.serverless-backup
cp vercel-container.json vercel.json
vercel --prod
```

## Additional Resources

- [Gunicorn Documentation](https://docs.gunicorn.org/)
- [Vercel Python Runtime](https://vercel.com/docs/concepts/functions/serverless-functions/runtimes/python)
- [Flask Deployment](https://flask.palletsprojects.com/en/3.0.x/deploying/)
- [Vercel Deployment Guide](./VERCEL_DEPLOYMENT.md)
