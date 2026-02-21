#!/usr/bin/env python3
"""
Add email and phone validation to create_participant function.
Run this from the backend directory.
"""

# Read the file
with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the UUID validation line and add email/phone validation after it
validation_code = '''
    # Validate email format
    email = data.get("email", "").strip().lower()
    if not email or not re.match(r'^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$', email):
        return jsonify({"error": "invalid email format"}), 400

    # Validate phone format
    phone = str(data.get("phone", "")).strip()
    if not phone or not re.match(r'^[0-9+ -]{8,15}$', phone):
        return jsonify({"error": "invalid phone number format (8-15 digits, can include +, -, and spaces)"}), 400

'''

# Check if validation already exists
if '# Validate email format' in content:
    print("Validation code already exists. Skipping.")
else:
    # Insert after UUID validation
    old_pattern = '''        return jsonify({"error": "invalid UUID format for public_id"}), 400

    db = get_db()'''

    new_pattern = '''        return jsonify({"error": "invalid UUID format for public_id"}), 400
''' + validation_code + '''    db = get_db()'''

    if old_pattern in content:
        content = content.replace(old_pattern, new_pattern)
        with open('app.py', 'w', encoding='utf-8') as f:
            f.write(content)
        print("✓ Email and phone validation added successfully!")
    else:
        print("✗ Could not find the expected pattern. Manual editing may be required.")
        print("   Looking for the line after: return jsonify({\"error\": \"invalid UUID format for public_id\"}), 400")
