# Gunicorn Setup for Vercel Production Deployment - Changes Summary

## Overview
This implementation enables the C.O.G.N.I.T. backend to be deployed to Vercel using Gunicorn for production-grade performance. The setup supports both serverless and container deployment options.

## Files Modified

### 1. `backend/.env.example`
**Added Gunicorn environment variables:**
- `GUNICORN_BIND` - Server binding address
- `GUNICORN_WORKERS` - Number of worker processes
- `GUNICORN_THREADS` - Threads per worker
- `GUNICORN_WORKER_CLASS` - Worker class (sync/gevent)
- `GUNICORN_TIMEOUT` - Request timeout
- `GUNICORN_KEEPALIVE` - Keep connection alive
- `GUNICORN_MAX_REQUESTS` - Worker recycling threshold
- `GUNICORN_MAX_REQUESTS_JITTER` - Randomization for recycling
- `GUNICORN_LOG_LEVEL` - Logging level
- `GUNICORN_ACCESS_LOG_FORMAT` - Custom log format

### 2. `backend/Dockerfile`
**Changes:**
- Added `curl` to system dependencies for health checks
- Updated CMD to use `gunicorn.conf.py` configuration file
- Simplified command for better maintainability
- All Gunicorn settings now managed centrally

### 3. `backend/Procfile`
**Changes:**
- Updated to use `gunicorn.conf.py` for consistency with Docker
- Removed hardcoded Gunicorn parameters
- Environment variables can now override settings

### 4. `backend/api/index.py`
**Changes:**
- Added `handler()` function for Vercel serverless compatibility
- Improved documentation for deployment scenarios
- Maintained Flask app export for Vercel

### 5. `backend/vercel.json`
**Changes:**
- Added `functions` configuration with Python 3.11 runtime
- Set `maxDuration` to 60 seconds for serverless functions
- Added routing rules for all API requests to `api/index.py`
- Configured for serverless deployment by default

## New Files Created

### 1. `backend/gunicorn.conf.py`
**Purpose:** Production-optimized Gunicorn configuration file

**Features:**
- Auto-calculates workers based on CPU cores (minimum 2)
- All settings configurable via environment variables
- Includes lifecycle hooks for monitoring
- Default settings optimized for production:
  - Workers: Auto-calculated (CPU cores × 2 + 1, min 2)
  - Threads: 4 per worker
  - Timeout: 60 seconds
  - Max requests: 1000 (worker recycling)
  - Keepalive: 5 seconds

### 2. `backend/vercel-container.json`
**Purpose:** Vercel configuration for container deployment with Gunicorn

**Features:**
- Enables Docker-based deployment on Vercel
- Allows full Gunicorn control and worker management
- Production-ready with Gunicorn support

### 3. `backend/VERCEL_DEPLOYMENT.md`
**Purpose:** Comprehensive deployment guide

**Contents:**
- Detailed deployment options (serverless vs container)
- Environment variables reference
- Performance tuning recommendations
- Troubleshooting guide
- Monitoring and logging setup

### 4. `backend/GUNICORN_SETUP.md`
**Purpose:** Gunicorn-specific setup documentation

**Contents:**
- Summary of all changes
- Deployment options explained
- Configuration details
- Local testing instructions
- Performance tuning guide
- Troubleshooting tips

### 5. `backend/deploy-vercel.sh`
**Purpose:** Automated deployment script

**Features:**
- Interactive deployment type selection
- Automatic configuration backup
- Environment variable validation
- Error handling and user confirmation
- Executable permissions set

## Deployment Options

### Option 1: Serverless Functions (Current Default)
- Uses `api/index.py` as Vercel serverless function
- No direct Gunicorn usage (Vercel's Python runtime)
- Best for: Development, low traffic, cost optimization
- Configuration: `vercel.json`

**Deploy:**
```bash
cd backend
vercel --prod
```

### Option 2: Container Deployment with Gunicorn (Recommended for Production)
- Uses Docker with full Gunicorn configuration
- Production-grade performance with worker processes
- Best for: Production, high traffic, full control
- Configuration: `Dockerfile` + `gunicorn.conf.py`

**Deploy using script:**
```bash
cd backend
./deploy-vercel.sh
# Choose option 2
```

**Deploy manually:**
```bash
cd backend
mv vercel.json vercel.serverless-backup.json
cp vercel-container.json vercel.json
mv api api.serverless-backup
vercel --prod
```

## Gunicorn Configuration

### Default Settings (via gunicorn.conf.py)
- **Workers**: Auto-calculated (CPU cores × 2 + 1, minimum 2)
- **Threads**: 4 per worker
- **Worker Class**: `sync` (configurable to `gevent`)
- **Timeout**: 60 seconds
- **Keepalive**: 5 seconds
- **Max Requests**: 1000 (worker recycling)
- **Log Level**: `info`

### Customization via Environment Variables
All settings can be overridden using environment variables:
```bash
export GUNICORN_WORKERS=4
export GUNICORN_THREADS=8
export GUNICORN_TIMEOUT=120
```

## Testing

### Local Gunicorn Test
```bash
cd backend
source .venv/bin/activate
export DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
gunicorn -c gunicorn.conf.py app:app
```

### Validate Configuration
```bash
gunicorn --check -c gunicorn.conf.py app:app
```

## Key Benefits

1. **Production-Ready**: Full Gunicorn control with worker processes and threads
2. **Flexible**: Supports both serverless and container deployment
3. **Configurable**: All settings can be customized via environment variables
4. **Maintainable**: Centralized configuration in `gunicorn.conf.py`
5. **Documented**: Comprehensive deployment and setup guides
6. **Automated**: Deployment script simplifies the process
7. **Monitoring**: Built-in health checks and logging
8. **Performance**: Optimized settings for production workloads

## Next Steps for Deployment

1. **Set Environment Variables** in Vercel Dashboard:
   - `DATABASE_URL` (required)
   - `SECRET_KEY` (required)
   - Payment and other optional variables

2. **Choose Deployment Type**:
   - Serverless for development/low traffic
   - Container for production/high traffic

3. **Deploy**:
   ```bash
   cd backend
   ./deploy-vercel.sh
   ```

4. **Monitor**:
   - Check Vercel Dashboard for logs
   - Use `vercel logs` CLI command
   - Monitor `/api/health` endpoint

5. **Scale** (if needed):
   - Adjust `GUNICORN_WORKERS` environment variable
   - Consider using `gevent` worker class for async
   - Enable Redis for distributed rate limiting

## References

- Gunicorn Documentation: https://docs.gunicorn.org/
- Vercel Python Runtime: https://vercel.com/docs/concepts/functions/serverless-functions/runtimes/python
- Flask Deployment: https://flask.palletsprojects.com/en/3.0.x/deploying/
