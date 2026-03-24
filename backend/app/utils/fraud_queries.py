"""Shared SQL query constants for fraud utilities."""

from sqlalchemy import text

QUERY_DUPLICATE_SCREENSHOT = text("""
    SELECT pf.payment_id, p.participant_id
    FROM payment_files pf
    JOIN payments p ON p.id = pf.payment_id
    WHERE pf.sha256 = :hash
    LIMIT 1
""")

QUERY_REJECTED_SCREENSHOT_FAST = text("""
    SELECT 1
    FROM payments
    WHERE status = :rejected_status
      AND uploaded_sha256 = :hash
    LIMIT 1
""")

QUERY_REJECTED_SCREENSHOT_FILE_HASH = text("""
    SELECT 1
    FROM payment_files pf
    JOIN payments p ON p.id = pf.payment_id
    WHERE p.status = :rejected_status
      AND pf.sha256 = :hash
    LIMIT 1
""")

QUERY_REJECTED_SCREENSHOT_ATTEMPTS = text("""
    SELECT 1
    FROM payment_upload_attempts pua
    JOIN payments p ON p.id = pua.payment_id
    WHERE p.status = :rejected_status
      AND pua.sha256 = :hash
    LIMIT 1
""")

QUERY_NEAR_DUPLICATE_PRIMARY = text("""
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
""")

QUERY_NEAR_DUPLICATE_FALLBACK = text("""
    SELECT
        pf.payment_id,
        p.participant_id,
        bit_count((pf.image_phash_bits # CAST(:bits AS bit(64)))) AS hamming_distance
    FROM payment_files pf
    JOIN payments p ON p.id = pf.payment_id
    WHERE pf.image_phash_bits IS NOT NULL
    ORDER BY hamming_distance ASC, p.created_at DESC
    LIMIT 256
""")

QUERY_NEAR_DUPLICATE_RECENT = text("""
    SELECT pf.payment_id, pf.image_phash, p.participant_id
    FROM payment_files pf
    JOIN payments p ON p.id = pf.payment_id
    WHERE pf.image_phash IS NOT NULL
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 1024
""")

QUERY_FINGERPRINT_MATCH_CURRENT = text("""
    SELECT 1
    FROM device_fingerprints
    WHERE participant_id = :other_pid
      AND fingerprint_hash = ANY(:fph_list)
    LIMIT 1
""")

QUERY_FINGERPRINT_MATCH_OVERLAP = text("""
    SELECT 1
    FROM device_fingerprints a
    JOIN device_fingerprints b
      ON a.fingerprint_hash = b.fingerprint_hash
    WHERE a.participant_id = :pid
      AND b.participant_id = :other_pid
    LIMIT 1
""")

QUERY_OCR_SIGNATURE_REPLAY = text("""
    SELECT pua.payment_id, p.participant_id
    FROM payment_upload_attempts pua
    JOIN payments p ON p.id = pua.payment_id
    WHERE pua.status IN (:attempt_success, :attempt_rejected, :attempt_duplicate)
      AND pua.sha256 <> :sha
      AND COALESCE(pua.details->>'ocr_signature', '') = :ocr_sig
    ORDER BY pua.created_at DESC
    LIMIT 1
""")
