"""
Fraud detection utilities module for C.O.G.N.I.T. backend.
Provides duplicate detection, screenshot validation, and fraud scoring.
"""

from typing import List, Optional, Tuple

from flask import current_app
from sqlalchemy import text

from app.config import ERROR_CODES
from app.utils.ocr import extract_upi_ref


# ────────────────────────────────────────────────
# Duplicate Screenshot Detection
# ────────────────────────────────────────────────

def check_duplicate_screenshot(db, sha256_hash: str) -> Tuple[bool, Optional[int]]:
    """
    Check if a screenshot with the given SHA256 hash already exists.
    
    Args:
        db: Database session
        sha256_hash: SHA256 hash of the screenshot file
        
    Returns:
        Tuple of (is_duplicate, existing_payment_id)
    """
    try:
        result = db.execute(text("""
            SELECT pf.payment_id, p.status
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.sha256 = :hash
            LIMIT 1
        """), {"hash": sha256_hash}).fetchone()
        
        if result:
            return True, result[0]
        return False, None
    except Exception as e:
        current_app.logger.warning(f"Duplicate screenshot check failed: {e}")
        return False, None


# ────────────────────────────────────────────────
# Rejected Screenshot Detection
# ────────────────────────────────────────────────

def check_rejected_screenshot(db, sha256_hash: str) -> bool:
    """
    Check if a screenshot with this hash was previously rejected.
    
    This prevents users from reusing screenshots that failed verification.
    
    Args:
        db: Database session
        sha256_hash: SHA256 hash of the screenshot file
        
    Returns:
        True if screenshot was previously rejected
    """
    try:
        result = db.execute(text("""
            SELECT 1
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.sha256 = :hash
              AND p.status = 'rejected_fraud'
            LIMIT 1
        """), {"hash": sha256_hash}).scalar()
        
        return bool(result)
    except Exception as e:
        current_app.logger.warning(f"Rejected screenshot check failed: {e}")
        return False


# ────────────────────────────────────────────────
# Duplicate Transaction Detection
# ────────────────────────────────────────────────

def check_duplicate_transaction(
    db, 
    upi_ref: str, 
    exclude_payment_id: Optional[int] = None
) -> Tuple[bool, Optional[str]]:
    """
    Check if a transaction ID has been used in any previous successful payment.
    
    Args:
        db: Database session
        upi_ref: UPI transaction reference
        exclude_payment_id: Optional payment ID to exclude from check
        
    Returns:
        Tuple of (is_duplicate, status_of_existing_payment)
    """
    if not upi_ref:
        return False, None
    
    try:
        query = """
            SELECT status
            FROM payments
            WHERE upi_txn_ref = :ref
        """
        params = {"ref": upi_ref}
        
        if exclude_payment_id:
            query += " AND id != :pid"
            params["pid"] = exclude_payment_id
        
        query += " LIMIT 1"
        
        result = db.execute(text(query), params).fetchone()
        
        if result:
            return True, result[0]
        return False, None
    except Exception as e:
        current_app.logger.warning(f"Duplicate transaction check failed: {e}")
        return False, None


# ────────────────────────────────────────────────
# Fraud Score Computation
# ────────────────────────────────────────────────

def compute_fraud_score(text: str, expected_amount: float) -> float:
    """
    Compute fraud score based on text analysis.
    
    Args:
        text: OCR extracted text
        expected_amount: Expected payment amount
        
    Returns:
        Fraud score (0-100, higher = more suspicious)
    """
    score = 0.0
    lower = text.lower()

    # Missing amount
    if f"{expected_amount:.2f}" not in lower:
        score += 30

    # Suspicious keywords
    if "failed" in lower:
        score += 40
    if "pending" in lower:
        score += 20

    # No transaction ID
    if not extract_upi_ref(text):
        score += 30

    return min(score, 100.0)