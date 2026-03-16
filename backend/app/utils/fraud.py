"""
Fraud detection utilities module for C.O.G.N.I.T. backend.
Provides duplicate detection, screenshot validation, and fraud scoring.
"""

import logging
from typing import Optional, Tuple

from PIL import Image

from app.constants.fraud_constants import (
    PAYMENT_UPLOAD_ATTEMPT_STATUS_DUPLICATE,
    PAYMENT_UPLOAD_ATTEMPT_STATUS_REJECTED,
    PAYMENT_UPLOAD_ATTEMPT_STATUS_SUCCESS,
)
from app.constants.observability_constants import (
    OBS_EVENT_FRAUD_DUPLICATE_CHECK_FAILED,
    OBS_EVENT_FRAUD_FINGERPRINT_SAME_PERSON_FAILED,
    OBS_EVENT_FRAUD_NEAR_DUP_FINAL_FALLBACK_FAILED,
    OBS_EVENT_FRAUD_NEAR_DUP_PRIMARY_FAILED,
    OBS_EVENT_FRAUD_NEAR_DUP_SQL_FALLBACK_FAILED,
    OBS_EVENT_FRAUD_OCR_SIGNATURE_REPLAY_FAILED,
    OBS_EVENT_FRAUD_REJECTED_ATTEMPTS_FAILED,
    OBS_EVENT_FRAUD_REJECTED_FAST_PATH_FAILED,
    OBS_EVENT_FRAUD_REJECTED_FILE_HASH_FAILED,
)
from app.utils.fraud_queries import (
    QUERY_DUPLICATE_SCREENSHOT,
    QUERY_FINGERPRINT_MATCH_CURRENT,
    QUERY_FINGERPRINT_MATCH_OVERLAP,
    QUERY_NEAR_DUPLICATE_FALLBACK,
    QUERY_NEAR_DUPLICATE_PRIMARY,
    QUERY_NEAR_DUPLICATE_RECENT,
    QUERY_OCR_SIGNATURE_REPLAY,
    QUERY_REJECTED_SCREENSHOT_ATTEMPTS,
    QUERY_REJECTED_SCREENSHOT_FAST,
    QUERY_REJECTED_SCREENSHOT_FILE_HASH,
)
from app.utils.observability import log_event

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
        result = db.execute(QUERY_DUPLICATE_SCREENSHOT, {"hash": sha256_hash}).fetchone()
        
        if result:
            existing_payment_id, existing_participant_id = result
            is_same_participant = (
                participant_id is not None and existing_participant_id == participant_id
            )
            return True, existing_payment_id, is_same_participant
        return False, None, False
    except Exception as e:
        log_event(logger, OBS_EVENT_FRAUD_DUPLICATE_CHECK_FAILED, level=logging.WARNING, error=str(e))
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
        hit = db.execute(QUERY_REJECTED_SCREENSHOT_FAST, {"hash": sha256_hash}).scalar()
        if hit:
            return True
    except Exception as e:
        log_event(logger, OBS_EVENT_FRAUD_REJECTED_FAST_PATH_FAILED, level=logging.WARNING, error=str(e))

    # Fallback path 1: historical file hashes linked to rejected payments.
    try:
        hit = db.execute(QUERY_REJECTED_SCREENSHOT_FILE_HASH, {"hash": sha256_hash}).scalar()
        if hit:
            return True
    except Exception as e:
        log_event(logger, OBS_EVENT_FRAUD_REJECTED_FILE_HASH_FAILED, level=logging.WARNING, error=str(e))

    # Fallback path 2: upload attempts on rejected payments.
    try:
        hit = db.execute(QUERY_REJECTED_SCREENSHOT_ATTEMPTS, {"hash": sha256_hash}).scalar()
        return bool(hit)
    except Exception as e:
        log_event(logger, OBS_EVENT_FRAUD_REJECTED_ATTEMPTS_FAILED, level=logging.WARNING, error=str(e))
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
        candidate = db.execute(QUERY_NEAR_DUPLICATE_PRIMARY, {"bits": bits, "bucket": bucket}).fetchone()

        if candidate:
            payment_id, owner_participant_id, distance = candidate
            distance = int(distance)
            if distance <= threshold:
                is_same_participant = (
                    participant_id is not None and owner_participant_id == participant_id
                )
                return True, int(payment_id), distance, is_same_participant
    except Exception as e:
        log_event(logger, OBS_EVENT_FRAUD_NEAR_DUP_PRIMARY_FAILED, level=logging.WARNING, error=str(e))

    # Secondary path: SQL distance scan (kept in DB), constrained candidate count.
    try:
        candidate = db.execute(QUERY_NEAR_DUPLICATE_FALLBACK, {"bits": bits}).fetchone()

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
        log_event(logger, OBS_EVENT_FRAUD_NEAR_DUP_SQL_FALLBACK_FAILED, level=logging.WARNING, error=str(e))

    # Final safety fallback: tiny Python scan from recent rows only.
    try:
        rows = db.execute(QUERY_NEAR_DUPLICATE_RECENT).fetchall()
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
        log_event(logger, OBS_EVENT_FRAUD_NEAR_DUP_FINAL_FALLBACK_FAILED, level=logging.WARNING, error=str(e))
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
            hit = db.execute(QUERY_FINGERPRINT_MATCH_CURRENT, {
                "other_pid": other_participant_id,
                "fph_list": candidate_hashes,
            }).scalar()
            if hit:
                return True

        overlap = db.execute(QUERY_FINGERPRINT_MATCH_OVERLAP, {
            "pid": participant_id,
            "other_pid": other_participant_id,
        }).scalar()
        return bool(overlap)
    except Exception as e:
        log_event(logger, OBS_EVENT_FRAUD_FINGERPRINT_SAME_PERSON_FAILED, level=logging.WARNING, error=str(e))
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
        row = db.execute(QUERY_OCR_SIGNATURE_REPLAY, {
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
        log_event(logger, OBS_EVENT_FRAUD_OCR_SIGNATURE_REPLAY_FAILED, level=logging.WARNING, error=str(e))
        return False, None, False
