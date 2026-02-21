#!/usr/bin/env python3
"""
This script applies the necessary patches to app.py for the new schema.
It should be run from the backend directory.
"""

import re
import os

# Get the directory of this script
script_dir = os.path.dirname(os.path.abspath(__file__))
app_py_path = os.path.join(script_dir, 'app.py')

# Read the file
with open(app_py_path, 'r') as f:
    content = f.read()

patches_applied = 0

# Patch 1: Add email and phone validation
pattern1 = r'(return jsonify\(\{"error": "invalid UUID format for public_id"\}\), 400)\n\n    db = get_db\(\)'
replacement1 = r'''\1

    # Validate email format
    email = data.get("email", "").strip().lower()
    if not email or not re.match(r'^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$', email):
        return jsonify({"error": "invalid email format"}), 400

    # Validate phone format
    phone = str(data.get("phone", "")).strip()
    if not phone or not re.match(r'^[0-9+ -]{8,15}$', phone):
        return jsonify({"error": "invalid phone number format (8-15 digits, can include +, -, and spaces)"}), 400

    db = get_db()'''

if re.search(pattern1, content):
    content = re.sub(pattern1, replacement1, content)
    patches_applied += 1
    print("✓ Patch 1 applied: Email and phone validation")
else:
    print("- Patch 1 already applied or not needed")

# Patch 2: Update email insert to use validated variable
if '"em": data.get("email", "").strip()[:255] or None,' in content:
    content = content.replace('"em": data.get("email", "").strip()[:255] or None,', '"em": email[:255],')
    patches_applied += 1
    print("✓ Patch 2 applied: Email insert uses validated value")
else:
    print("- Patch 2 already applied or not needed")

# Patch 3: Update phone insert to use validated variable
if '"ph": data.get("phone", "").strip()[:20] or None,' in content:
    content = content.replace('"ph": data.get("phone", "").strip()[:20] or None,', '"ph": phone[:20],')
    patches_applied += 1
    print("✓ Patch 3 applied: Phone insert uses validated value")
else:
    print("- Patch 3 already applied or not needed")

# Patch 4: Update error handling
old_error = '''        if "unique" in str(e).lower():
            return jsonify({"error": "public_id or username conflict"}), 409'''
new_error = '''        error_msg = str(e).lower()
        if "unique" in error_msg:
            if "public_id" in error_msg:
                return jsonify({"error": "public_id already exists"}), 409
            elif "username" in error_msg:
                return jsonify({"error": "username already taken"}), 409
            elif "email" in error_msg:
                return jsonify({"error": "email already registered"}), 409
            elif "phone" in error_msg:
                return jsonify({"error": "phone number already registered"}), 409
            return jsonify({"error": "unique constraint violation"}), 409'''

if old_error in content:
    content = content.replace(old_error, new_error)
    patches_applied += 1
    print("✓ Patch 4 applied: Enhanced unique constraint error messages")
else:
    print("- Patch 4 already applied or not needed")

# Patch 5: Update API docs
if '"email": "optional@example.com",' in content:
    content = content.replace('"email": "optional@example.com",', '"email": "required@example.com",')
    patches_applied += 1
    print("✓ Patch 5 applied: API docs email marked as required")
else:
    print("- Patch 5 already applied or not needed")

if '"phone": "optional"' in content:
    content = content.replace('"phone": "optional"', '"phone": "+919876543210"')
    patches_applied += 1
    print("✓ Patch 6 applied: API docs phone example added")
else:
    print("- Patch 6 already applied or not needed")

# Write the updated content back
with open(app_py_path, 'w') as f:
    f.write(content)

print(f"\nPatching complete! {patches_applied} patch(es) applied.")
