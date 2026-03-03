"""
Fraud detection utilities module for C.O.G.N.I.T. backend.
Provides duplicate detection, screenshot validation, and fraud scoring.
"""

from typing import Optional, Tuple

from sqlalchemy import text
from PIL import Image


# ────────────────────────────────────────────────
# Duplicate Screenshot Detection
# ────────────────────────────────────────────────

def check_duplicate_screenshot(
    db,
    sha256_hash: str,
    participant_id: Optional[int] = None
) -> Tuple[bool, Optional[int], bool]:
    """
    Check if a screenshot with the given SHA256 hash already exists.
    
    Args:
        db: Database session
        sha256_hash: SHA256 hash of the screenshot file
        
    Returns:
        Tuple of (is_duplicate, existing_payment_id, is_same_participant)
    """
    try:
        result = db.execute(text("""
            SELECT pf.payment_id, p.participant_id
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.sha256 = :hash
            LIMIT 1
        """), {"hash": sha256_hash}).fetchone()
        
        if result:
            existing_payment_id, existing_participant_id = result
            is_same_participant = (
                participant_id is not None and existing_participant_id == participant_id
            )
            return True, existing_payment_id, is_same_participant
        return False, None, False
    except Exception as e:
        print(f"[WARN] Duplicate screenshot check failed: {e}", flush=True)
        return False, None, False


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


def compute_dhash(image: Image.Image, hash_size: int = 8) -> str:
    """
    Compute a perceptual difference hash (dHash) for near-duplicate detection.

    Returns:
        Hex string representation of the hash.
    """
    gray = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    rows = [pixels[i * (hash_size + 1):(i + 1) * (hash_size + 1)] for i in range(hash_size)]
    bits = []
    for row in rows:
        for i in range(hash_size):
            bits.append(1 if row[i] > row[i + 1] else 0)
    bit_string = "".join("1" if b else "0" for b in bits)
    return f"{int(bit_string, 2):0{hash_size * hash_size // 4}x}"


def _hamming_distance_hex(hash_a: str, hash_b: str) -> int:
    """Compute Hamming distance between two hex hashes."""
    if not hash_a or not hash_b:
        return 999
    if len(hash_a) != len(hash_b):
        return 999
    value = int(hash_a, 16) ^ int(hash_b, 16)
    return value.bit_count()


def check_near_duplicate_screenshot(
    db,
    image_hash: str,
    participant_id: Optional[int] = None,
    threshold: int = 6
) -> Tuple[bool, Optional[int], Optional[int], bool]:
    """
    Check near-duplicate screenshot using perceptual hash distance.

    Returns:
        Tuple of (is_near_duplicate, existing_payment_id, min_distance, is_same_participant)
    """
    try:
        rows = db.execute(text("""
            SELECT pf.payment_id, pf.image_phash, p.participant_id
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.image_phash IS NOT NULL
            LIMIT 5000
        """)).fetchall()
        best_payment = None
        best_distance = None
        best_participant = None
        for payment_id, stored_hash, owner_participant_id in rows:
            distance = _hamming_distance_hex(image_hash, stored_hash)
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_payment = payment_id
                best_participant = owner_participant_id
        if best_distance is not None and best_distance <= threshold:
            is_same_participant = (
                participant_id is not None and best_participant == participant_id
            )
            return True, best_payment, best_distance, is_same_participant
        return False, None, best_distance, False
    except Exception as e:
        print(f"[WARN] Near-duplicate screenshot check failed: {e}", flush=True)
        return False, None, None, False
