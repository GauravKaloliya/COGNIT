"""
Security utilities module for C.O.G.N.I.T. backend.
Provides payment signature generation, UPI link generation, and security helpers.
"""

import hashlib
import hmac
import urllib.parse

from app.config import PAYMENT_SECRET, UPI_VPA, UPI_NAME


# ────────────────────────────────────────────────
# Payment Signature Generation
# ────────────────────────────────────────────────

def generate_payment_signature(public_id: str, amount: str, expires_at: str) -> str:
    """
    Generate HMAC-SHA256 signature for payment validation.
    
    Args:
        public_id: Payment public identifier (UUID)
        amount: Payment amount as string
        expires_at: ISO format expiration timestamp
        
    Returns:
        Hexadecimal signature string
    """
    payload = f"{public_id}:{amount}:{expires_at}"
    return hmac.new(
        PAYMENT_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()


# ────────────────────────────────────────────────
# UPI Link Generation
# ────────────────────────────────────────────────

def generate_upi_link(amount: float, note: str) -> str:
    """
    Generate UPI payment link for mobile apps.
    
    Args:
        amount: Payment amount in INR
        note: Payment note/reference
        
    Returns:
        UPI payment URI string
    """
    params = {
        "pa": UPI_VPA,
        "pn": UPI_NAME,
        "am": f"{amount:.2f}",
        "cu": "INR",
        "tn": note
    }
    return "upi://pay?" + urllib.parse.urlencode(params)