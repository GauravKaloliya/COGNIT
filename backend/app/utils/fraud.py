"""
Fraud detection utilities module for C.O.G.N.I.T. backend.
Provides duplicate detection, screenshot validation, and fraud scoring.
"""

import logging
from typing import Optional, Tuple

from sqlalchemy import text
from PIL import Image

logger = logging.getLogger(__name__)


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
        logger.warning("duplicate screenshot check failed error=%s", e)
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
    # Fast path: denormalized indexed hash on payments.
    try:
        hit = db.execute(text("""
            SELECT 1
            FROM payments
            WHERE status = 'rejected_fraud'
              AND uploaded_sha256 = :hash
            LIMIT 1
        """), {"hash": sha256_hash}).scalar()
        if hit:
            return True
    except Exception as e:
        logger.warning("rejected screenshot fast-path check failed error=%s", e)

    # Fallback path 1: historical file hashes linked to rejected payments.
    try:
        hit = db.execute(text("""
            SELECT 1
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE p.status = 'rejected_fraud'
              AND pf.sha256 = :hash
            LIMIT 1
        """), {"hash": sha256_hash}).scalar()
        if hit:
            return True
    except Exception as e:
        logger.warning("rejected screenshot file-hash check failed error=%s", e)

    # Fallback path 2: upload attempts on rejected payments.
    try:
        hit = db.execute(text("""
            SELECT 1
            FROM payment_upload_attempts pua
            JOIN payments p ON p.id = pua.payment_id
            WHERE p.status = 'rejected_fraud'
              AND pua.sha256 = :hash
            LIMIT 1
        """), {"hash": sha256_hash}).scalar()
        return bool(hit)
    except Exception as e:
        logger.warning("rejected screenshot attempts check failed error=%s", e)
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


def phash_hex_to_bits_and_bucket(image_hash: str) -> Tuple[Optional[str], Optional[int]]:
    """
    Convert 64-bit perceptual hash hex into bit-string and a coarse prefix bucket.
    """
    if not image_hash:
        return None, None
    normalized = str(image_hash).strip().lower()
    if len(normalized) != 16:
        return None, None
    try:
        value = int(normalized, 16)
    except Exception:
        return None, None
    bits = f"{value:064b}"
    bucket = int(bits[:16], 2)
    return bits, bucket


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
    bits, bucket = phash_hex_to_bits_and_bucket(image_hash)
    if not bits:
        return False, None, None, False

    # Primary path: indexed coarse-bucket search, distance filter in SQL.
    try:
        candidate = db.execute(text("""
            SELECT
                pf.payment_id,
                p.participant_id,
                bit_count((pf.image_phash_bits # CAST(:bits AS bit(64)))) AS hamming_distance
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.image_phash_bits IS NOT NULL
              AND pf.image_phash_bucket = :bucket
            ORDER BY hamming_distance ASC, p.created_at DESC
            LIMIT 128
        """), {"bits": bits, "bucket": bucket}).fetchone()

        if candidate:
            payment_id, owner_participant_id, distance = candidate
            distance = int(distance)
            if distance <= threshold:
                is_same_participant = (
                    participant_id is not None and owner_participant_id == participant_id
                )
                return True, int(payment_id), distance, is_same_participant
    except Exception as e:
        logger.warning("near-duplicate primary SQL check failed error=%s", e)

    # Secondary path: SQL distance scan (kept in DB), constrained candidate count.
    try:
        candidate = db.execute(text("""
            SELECT
                pf.payment_id,
                p.participant_id,
                bit_count((pf.image_phash_bits # CAST(:bits AS bit(64)))) AS hamming_distance
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.image_phash_bits IS NOT NULL
            ORDER BY hamming_distance ASC, p.created_at DESC
            LIMIT 256
        """), {"bits": bits}).fetchone()

        if candidate:
            payment_id, owner_participant_id, distance = candidate
            distance = int(distance)
            if distance <= threshold:
                is_same_participant = (
                    participant_id is not None and owner_participant_id == participant_id
                )
                return True, int(payment_id), distance, is_same_participant
            return False, None, distance, False
        return False, None, None, False
    except Exception as e:
        logger.warning("near-duplicate SQL fallback failed error=%s", e)

    # Final safety fallback: tiny Python scan from recent rows only.
    try:
        rows = db.execute(text("""
            SELECT pf.payment_id, pf.image_phash, p.participant_id
            FROM payment_files pf
            JOIN payments p ON p.id = pf.payment_id
            WHERE pf.image_phash IS NOT NULL
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT 1024
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
        logger.warning("near-duplicate final fallback failed error=%s", e)
        return False, None, None, False


def is_same_person_by_fingerprint(
    db,
    participant_id: Optional[int],
    other_participant_id: Optional[int],
    current_fingerprint: Optional[str] = None,
    current_fingerprint_variants: Optional[list[str]] = None,
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
        candidate_hashes = []
        if current_fingerprint:
            candidate_hashes.append(current_fingerprint)
        if current_fingerprint_variants:
            candidate_hashes.extend([h for h in current_fingerprint_variants if h])
        candidate_hashes = list(dict.fromkeys([h for h in candidate_hashes if h]))

        if candidate_hashes:
            hit = db.execute(text("""
                SELECT 1
                FROM device_fingerprints
                WHERE participant_id = :other_pid
                  AND fingerprint_hash = ANY(:fph_list)
                LIMIT 1
            """), {
                "other_pid": other_participant_id,
                "fph_list": candidate_hashes,
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
        logger.warning("fingerprint same-person check failed error=%s", e)
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
        logger.warning("ocr signature replay check failed error=%s", e)
        return False, None, False
