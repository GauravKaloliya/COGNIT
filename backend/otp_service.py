import os
import requests
import time
from datetime import datetime, timedelta

MC_CUSTOMER_ID = os.getenv("MC_CUSTOMER_ID")
MC_KEY = os.getenv("MC_KEY")
MC_BASE_URL = os.getenv("MC_BASE_URL", "https://cpaas.messagecentral.com")

# In-memory token cache
_token_cache = {
    "token": None,
    "expires_at": None
}


# =====================================================
# Generate Auth Token (VerifyNow v3)
# =====================================================
def generate_token():
    global _token_cache

    # Return cached token if valid
    if _token_cache["token"] and _token_cache["expires_at"]:
        if datetime.utcnow() < _token_cache["expires_at"]:
            return _token_cache["token"]

    url = f"{MC_BASE_URL}/auth/v1/authentication"

    payload = {
        "customerId": MC_CUSTOMER_ID,
        "key": MC_KEY
    }

    headers = {
        "Content-Type": "application/x-www-form-urlencoded"
    }

    response = requests.post(url, data=payload, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Token generation failed: {response.status_code} - {response.text}")

    data = response.json()

    token = data.get("token")
    if not token:
        raise Exception(f"No token received from MessageCentral: {data}")

    # Cache token (assume long expiry, refresh every 6 hours)
    _token_cache["token"] = token
    _token_cache["expires_at"] = datetime.utcnow() + timedelta(hours=6)

    return token


# =====================================================
# Send OTP (VerifyNow v3)
# =====================================================
def send_otp(mobile):
    auth_token = generate_token()

    url = f"{MC_BASE_URL}/verification/v3/send"

    payload = {
        "mobileNumber": f"91{mobile}",
        "flowType": "SMS",
        "otpLength": 6
    }

    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=payload, headers=headers)

    if response.status_code != 200:
        raise Exception(f"OTP send failed: {response.status_code} - {response.text}")

    data = response.json()

    verification_id = (
        data.get("data", {}).get("verificationId")
        or data.get("verificationId")
    )

    if not verification_id:
        raise Exception(f"Verification ID missing in response: {data}")

    return {
        "verificationId": verification_id,
        "raw": data
    }


# =====================================================
# Verify OTP (VerifyNow v3)
# =====================================================
def verify_otp(verification_id, otp_code):
    auth_token = generate_token()

    url = f"{MC_BASE_URL}/verification/v3/verify"

    payload = {
        "verificationId": verification_id,
        "otp": otp_code
    }

    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=payload, headers=headers)

    if response.status_code != 200:
        raise Exception(f"OTP verify failed: {response.status_code} - {response.text}")

    data = response.json()

    return data
