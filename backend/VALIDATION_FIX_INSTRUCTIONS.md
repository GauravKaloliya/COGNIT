# Manual Fix Required: Add Email and Phone Validation

The backend `create_participant` function in `app.py` needs validation code added for email and phone fields.

## Location
File: `/home/engine/project/backend/app.py`
Function: `create_participant` (starts around line 384)

## What to Add
Insert the following validation code **after** line 393 (after the UUID validation `return jsonify({"error": "invalid UUID format for public_id"}), 400`):

```python
    # Validate email format
    email = data.get("email", "").strip().lower()
    if not email or not re.match(r'^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$', email):
        return jsonify({"error": "invalid email format"}), 400

    # Validate phone format
    phone = str(data.get("phone", "")).strip()
    if not phone or not re.match(r'^[0-9+ -]{8,15}$', phone):
        return jsonify({"error": "invalid phone number format (8-15 digits, can include +, -, and spaces)"}), 400

```

## Why This is Needed

1. The schema now requires `email` and `phone` to be NOT NULL and UNIQUE
2. The code later references `email[:255]` and `phone[:20]` variables that must be defined
3. Without this validation, the API will throw a runtime error when trying to insert data

## Alternative: Run the Patch Script

Instead of manually editing, you can run:

```bash
cd /home/engine/project/backend
python3 add_validation.py
```

This script will automatically add the validation code if it detects it's missing.
