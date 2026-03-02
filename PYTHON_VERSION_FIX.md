# Python Version Fix for Vercel Deployment

## Problem
Vercel was using Python 3.14 during the build process, which is too new and unstable for the project dependencies. This caused a `KeyError: '__version__'` build error when running `uv pip install` because many packages don't yet support Python 3.14.

## Solution
Added explicit Python version configuration to force Vercel to use Python 3.11, a stable and widely-supported version.

## Files Created/Modified

### 1. Root Directory Files

#### `.python-version` (NEW)
```
3.11
```
Specifies the exact Python version to use.

#### `pyproject.toml` (NEW)
```
[project]
name = "cognit"
version = "0.1.0"
description = "Cognitive Image & Text Research Platform"
requires-python = ">=3.11,<3.13"
...
```
Specifies that the project requires Python 3.11 or 3.12, but not 3.13+.

#### `vercel.json` (NEW)
```json
{
  "buildCommand": "cd backend && uv pip install --system -r requirements.txt",
  "outputDirectory": "backend",
  "installCommand": "pip install uv",
  "framework": null,
  "regions": ["iad1"],
  "functions": {
    "backend/api/*.py": {
      "runtime": "python3.11"
    }
  }
}
```
Configures Vercel to use Python 3.11 for backend API functions.

### 2. Backend Directory Files

#### `backend/.python-version` (NEW)
```
3.11
```
Specifies Python 3.11 for the backend specifically.

#### `backend/pyproject.toml` (NEW)
```
[project]
name = "cognit-backend"
version = "0.1.0"
description = "Cognitive Image & Text Research Platform - Backend API"
requires-python = ">=3.11,<3.13"
...
```
Python version constraint for the backend.

#### `backend/vercel.json` (MODIFIED)
```json
{
  "version": 2,
  "outputDirectory": ".",
  "framework": null,
  "ignoreCommand": "git diff --quiet HEAD^ HEAD -- .",
  "builds": [
    {
      "src": "main.py",
      "use": "@vercel/python"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "main.py"
    }
  ]
}
```
Added explicit build configuration using `@vercel/python` builder, which respects the Python version specifications.

## How It Works

1. **`.python-version`**: This file is read by Vercel's Python builder to determine which Python version to use.

2. **`pyproject.toml`**: The `requires-python` field tells package managers (pip, uv) which Python versions are compatible with the project.

3. **`vercel.json`**: 
   - The `runtime: "python3.11"` explicitly tells Vercel to use Python 3.11
   - The `@vercel/python` builder respects both the `.python-version` file and the `requires-python` constraint

## Why Python 3.11?

- **Stability**: Python 3.11 is mature and stable, with all dependencies fully tested and supported
- **Performance**: Python 3.11 includes significant performance improvements over 3.10
- **Compatibility**: All packages in requirements.txt support Python 3.11
- **Future-proof**: 3.11 will receive security updates until October 2027

## Expected Outcome

When deploying to Vercel:
1. Vercel will detect the `.python-version` file and use Python 3.11
2. The `@vercel/python` builder will install dependencies using Python 3.11
3. All packages will build successfully without version errors
4. The application will run on a stable, supported Python version
