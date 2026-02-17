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

    if _token_cache["token"] and _token_cache["expires_at"]:
        if datetime.utcnow() < _token_cache["expires_at"]:
            return _token_cache["token"]

    url = f"{MC_BASE_URL}/auth/v1/authentication/token"

    params = {
        "customerId": MC_CUSTOMER_ID,
        "key": MC_KEY,
        "scope": "NEW",
        "country": "91"
    }

    response = requests.get(url, params=params)

    if response.status_code != 200:
        raise Exception(f"Token generation failed: {response.status_code} - {response.text}")

    data = response.json()

    token = data.get("token")
    if not token:
        raise Exception(f"No token received from MessageCentral: {data}")

    _token_cache["token"] = token
    _token_cache["expires_at"] = datetime.utcnow() + timedelta(hours=6)

    return token


# =====================================================
# Send OTP (VerifyNow v3)
# =====================================================
def send_otp(mobile):
    auth_token = generate_token()

    url = f"{MC_BASE_URL}/verification/v3/send"

    params = {
        "customerId": MC_CUSTOMER_ID,
        "mobileNumber": mobile,
        "countryCode": "91",
        "flowType": "SMS",
        "otpLength": 6
    }

    headers = {
        "authToken": auth_token
    }

    response = requests.post(url, headers=headers, params=params)

    if response.status_code != 200:
        raise Exception(f"OTP send failed: {response.status_code} - {response.text}")

    data = response.json()

    verification_id = data.get("data", {}).get("verificationId") or data.get("verificationId")

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

    url = f"{MC_BASE_URL}/verification/v3/validateOtp"

    params = {
        "verificationId": verification_id,
        "code": otp_code,
        "flowType": "SMS"
    }

    headers = {
        "authToken": auth_token
    }

    response = requests.post(url, headers=headers, params=params)

    if response.status_code != 200:
        raise Exception(f"OTP verify failed: {response.status_code} - {response.text}")

    data = response.json()

    return data
