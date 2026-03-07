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
            FROM payments p
            LEFT JOIN payment_files pf ON pf.payment_id = p.id
            WHERE p.status = 'rejected_fraud'
              AND (
                    pf.sha256 = :hash
                    OR EXISTS (
                        SELECT 1
                        FROM payment_upload_attempts pua
                        WHERE pua.payment_id = p.id
                          AND pua.sha256 = :hash
                    )
                    OR p.metadata->>'uploaded_sha256' = :hash
                    OR p.verification_details->>'uploaded_sha256' = :hash
              )
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
            ORDER BY p.created_at DESC, p.id DESC
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


def is_same_person_by_fingerprint(
    db,
    participant_id: Optional[int],
    other_participant_id: Optional[int],
    current_fingerprint: Optional[str] = None
) -> bool:
    """
    Best-effort same-person check using device fingerprint overlap.

    Returns True when participants share at least one fingerprint hash or the
    current request fingerprint matches the other participant.
    """
    if not participant_id or not other_participant_id:
        return False
    if participant_id == other_participant_id:
        return True
    try:
        if current_fingerprint:
            hit = db.execute(text("""
                SELECT 1
                FROM device_fingerprints
                WHERE participant_id = :other_pid
                  AND fingerprint_hash = :fph
                LIMIT 1
            """), {
                "other_pid": other_participant_id,
                "fph": current_fingerprint,
            }).scalar()
            if hit:
                return True

        overlap = db.execute(text("""
            SELECT 1
            FROM device_fingerprints a
            JOIN device_fingerprints b
              ON a.fingerprint_hash = b.fingerprint_hash
            WHERE a.participant_id = :pid
              AND b.participant_id = :other_pid
            LIMIT 1
        """), {
            "pid": participant_id,
            "other_pid": other_participant_id,
        }).scalar()
        return bool(overlap)
    except Exception as e:
        print(f"[WARN] Fingerprint same-person check failed: {e}", flush=True)
        return False


def check_ocr_signature_replay(
    db,
    ocr_signature: str,
    sha256_hash: str,
    participant_id: Optional[int] = None,
) -> Tuple[bool, Optional[int], bool]:
    """
    Detect replay attempts where OCR-verification semantics are identical
    even if image bytes/hash were modified.
    """
    if not ocr_signature:
        return False, None, False
    try:
        row = db.execute(text("""
            SELECT pua.payment_id, p.participant_id
            FROM payment_upload_attempts pua
            JOIN payments p ON p.id = pua.payment_id
            WHERE pua.status IN ('success', 'rejected', 'duplicate')
              AND pua.sha256 <> :sha
              AND COALESCE(pua.details->>'ocr_signature', '') = :ocr_sig
            ORDER BY pua.created_at DESC
            LIMIT 1
        """), {
            "sha": sha256_hash,
            "ocr_sig": ocr_signature,
        }).fetchone()
        if not row:
            return False, None, False
        existing_payment_id, existing_participant_id = row
        is_same_participant = (
            participant_id is not None and int(existing_participant_id or 0) == int(participant_id)
        )
        return True, int(existing_payment_id), is_same_participant
    except Exception as e:
        print(f"[WARN] OCR signature replay check failed: {e}", flush=True)
        return False, None, False
