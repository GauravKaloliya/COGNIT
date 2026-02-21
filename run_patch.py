#!/usr/bin/env python3
import sys
import os

# Add the backend directory to sys.path
sys.path.insert(0, '/home/engine/project/backend')

# Import and execute the patch
exec(open('/home/engine/project/backend/apply_patches.py').read())
