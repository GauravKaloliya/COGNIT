"""
OTP Service Module
Handles MessageCentral OTP verification integration
"""

import re
from datetime import datetime, timezone, timedelta
from flask import current_app
import requests


# Token cache for MessageCentral auth token
_token_cache = {
    "token": None,
    "expires_at": None
}


def get_mc_auth_token():
    """
    Get or generate MessageCentral auth token with caching.
    Tokens are cached and regenerated only when expired.
    """
    global _token_cache

    # Check if we have a valid cached token
    if _token_cache["token"] and _token_cache["expires_at"]:
        if datetime.now(timezone.utc) < _token_cache["expires_at"]:
            return _token_cache["token"]

    # Generate new token
    import os
    mc_customer_id = os.getenv("MC_CUSTOMER_ID")
    mc_key = os.getenv("MC_KEY")
    mc_base_url = os.getenv("MC_BASE_URL", "https://cpaas.messagecentral.com")

    if not mc_customer_id or not mc_key:
        raise ValueError("MessageCentral credentials not configured")

    try:
        url = f"{mc_base_url}/auth/v1/authentication/token"
        params = {
            "customerId": mc_customer_id,
            "key": mc_key,
            "scope": "NEW"
        }

        response = requests.get(url, params=params, timeout=10)

        if response.status_code == 200:
            token_data = response.json()
            auth_token = token_data.get("authToken")
            if auth_token:
                # Cache token with expiry (tokens typically last 24 hours, we'll use 23 hours for safety)
                _token_cache["token"] = auth_token
                _token_cache["expires_at"] = datetime.now(timezone.utc) + timedelta(hours=23)
                current_app.logger.info("MessageCentral auth token generated and cached successfully")
                return auth_token
            else:
                raise Exception("No authToken in response")
        else:
            error_msg = f"Token generation failed with status {response.status_code}: {response.text}"
            current_app.logger.error(error_msg)
            raise Exception(error_msg)
    except requests.exceptions.RequestException as e:
        current_app.logger.error(f"Network error generating MessageCentral token: {e}")
        raise Exception(f"Failed to connect to MessageCentral: {str(e)}")
    except Exception as e:
        current_app.logger.error(f"Error generating MessageCentral token: {e}")
        raise e


def validate_indian_mobile(mobile: str) -> bool:
    """Validate Indian mobile number format."""
    if not mobile:
        return False
    mobile_digits = re.sub(r'\D', '', mobile)
    return re.match(r'^[6-9]\d{9}$', mobile_digits) is not None


def send_otp(mobile: str):
    """
    Send OTP to the specified mobile number using MessageCentral API.
    
    Args:
        mobile: 10-digit Indian mobile number
    
    Returns:
        dict: Response from MessageCentral API with verificationId
    """
    import os
    
    # Validate mobile number
    if not validate_indian_mobile(mobile):
        raise ValueError("Invalid Indian mobile number format")

    mc_base_url = os.getenv("MC_BASE_URL", "https://cpaas.messagecentral.com")
    
    try:
        auth_token = get_mc_auth_token()
        
        url = f"{mc_base_url}/verification/v3/send"
        
        payload = {
            "customerId": os.getenv("MC_CUSTOMER_ID"),
            "mobileNumber": f"91{mobile}",
            "flowType": "SMS",
            "otpLength": 6
        }

        headers = {
            "authToken": auth_token,
            "Content-Type": "application/json"
        }

        response = requests.post(url, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            return response.json()
        else:
            error_msg = f"Failed to send OTP: {response.status_code} - {response.text}"
            current_app.logger.error(error_msg)
            raise Exception(error_msg)
            
    except requests.exceptions.RequestException as e:
        current_app.logger.error(f"Network error sending OTP: {e}")
        raise Exception(f"Failed to connect to MessageCentral: {str(e)}")


def verify_otp(verification_id: str, otp: str):
    """
    Verify OTP using the verification ID and OTP code.
    
    Args:
        verification_id: Verification ID from send_otp response
        otp: 6-digit OTP code
    
    Returns:
        dict: Response from MessageCentral API with verification status
    """
    import os
    
    if not verification_id or not otp:
        raise ValueError("verificationId and otp are required")

    mc_base_url = os.getenv("MC_BASE_URL", "https://cpaas.messagecentral.com")
    
    try:
        auth_token = get_mc_auth_token()
        
        url = f"{mc_base_url}/verification/v3/validateOtp"

        payload = {
            "verificationId": verification_id,
            "code": otp
        }

        headers = {
            "authToken": auth_token,
            "Content-Type": "application/json"
        }

        response = requests.post(url, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            return response.json()
        else:
            error_msg = f"Failed to verify OTP: {response.status_code} - {response.text}"
            current_app.logger.error(error_msg)
            raise Exception(error_msg)
            
    except requests.exceptions.RequestException as e:
        current_app.logger.error(f"Network error verifying OTP: {e}")
        raise Exception(f"Failed to connect to MessageCentral: {str(e)}")
