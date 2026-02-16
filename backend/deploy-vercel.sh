#!/bin/bash

# Vercel Deployment Script for C.O.G.N.I.T. Backend with Gunicorn
# This script helps deploy the backend to Vercel using container deployment with Gunicorn

set -e

echo "======================================"
echo "C.O.G.N.I.T. Backend Vercel Deployment"
echo "======================================"
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Error: Vercel CLI is not installed."
    echo "Please install it with: npm install -g vercel"
    exit 1
fi

echo "✅ Vercel CLI found"
echo ""

# Ask for deployment type
echo "Choose deployment type:"
echo "1) Serverless Functions (default, no Gunicorn)"
echo "2) Container Deployment with Gunicorn (recommended for production)"
read -p "Enter choice (1 or 2) [default: 1]: " choice
choice=${choice:-1}

if [ "$choice" = "2" ]; then
    echo ""
    echo "🚀 Setting up container deployment with Gunicorn..."

    # Backup current vercel.json if it exists
    if [ -f "vercel.json" ]; then
        cp vercel.json vercel.serverless-backup.json
        echo "✅ Backed up current vercel.json to vercel.serverless-backup.json"
    fi

    # Use container deployment config
    if [ -f "vercel-container.json" ]; then
        cp vercel-container.json vercel.json
        echo "✅ Applied container deployment configuration"
    fi

    # Backup api directory
    if [ -d "api" ]; then
        mv api api.serverless-backup
        echo "✅ Backed up api/ directory to api.serverless-backup/"
    fi

    echo ""
    echo "📦 Configuration Summary:"
    echo "   - Deployment: Container with Gunicorn"
    echo "   - Workers: 2 (configurable via GUNICORN_WORKERS env var)"
    echo "   - Threads: 4 (configurable via GUNICORN_THREADS env var)"
    echo "   - Timeout: 60 seconds"
    echo "   - Port: 5000"
    echo ""

else
    echo ""
    echo "🚀 Setting up serverless function deployment..."
    echo "⚠️  Note: Serverless functions do not use Gunicorn directly"
    echo ""

    # Ensure serverless config is in place
    if [ ! -f "vercel.json" ]; then
        echo "❌ Error: vercel.json not found for serverless deployment"
        exit 1
    fi

    # Ensure api directory exists
    if [ ! -d "api" ]; then
        if [ -d "api.serverless-backup" ]; then
            mv api.serverless-backup api
            echo "✅ Restored api/ directory from backup"
        else
            echo "❌ Error: api/ directory not found"
            exit 1
        fi
    fi

    echo ""
    echo "📦 Configuration Summary:"
    echo "   - Deployment: Serverless Functions"
    echo "   - Runtime: Python 3.11"
    echo "   - Max Duration: 60 seconds"
    echo "   - Handler: api/index.py"
    echo ""
fi

# Verify environment variables
echo "🔍 Checking required environment variables..."
required_vars=("DATABASE_URL" "SECRET_KEY")
missing_vars=()

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  Warning: The following environment variables are not set locally:"
    printf "   - %s\n" "${missing_vars[@]}"
    echo ""
    echo "You can set these in Vercel Dashboard or using vercel env add"
    echo ""
fi

read -p "Continue with deployment? (y/n) [default: y]: " confirm
confirm=${confirm:-y}

if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "❌ Deployment cancelled"
    exit 0
fi

echo ""
echo "🚀 Deploying to Vercel..."
echo ""

# Deploy to Vercel
if vercel --prod; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📚 Next steps:"
    if [ "$choice" = "2" ]; then
        echo "   1. Monitor your deployment in Vercel Dashboard"
        echo "   2. Check logs: vercel logs"
        echo "   3. Test the API endpoints"
        echo "   4. To revert to serverless: ./deploy-vercel.sh and choose option 1"
    else
        echo "   1. Monitor your deployment in Vercel Dashboard"
        echo "   2. Check logs: vercel logs"
        echo "   3. Test the API endpoints"
        echo "   4. To use Gunicorn: ./deploy-vercel.sh and choose option 2"
    fi
    echo ""
    echo "📖 For more information, see VERCEL_DEPLOYMENT.md"
else
    echo ""
    echo "❌ Deployment failed"
    echo "Please check the error messages above and try again"
    exit 1
fi
