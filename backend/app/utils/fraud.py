"""
Fraud detection utilities module for C.O.G.N.I.T. backend.
Provides duplicate detection, screenshot validation, and fraud scoring.
"""

from typing import Optional, Tuple

from sqlalchemy import text


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
        print(f"[WARN] Duplicate screenshot check failed: {e}", flush=True)
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
        print(f"[WARN] Rejected screenshot check failed: {e}", flush=True)
        return False

