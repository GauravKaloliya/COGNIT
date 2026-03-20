"""
OCR utilities module for C.O.G.N.I.T. backend.
Provides text extraction, UPI app detection, and payment screenshot verification.
Uses Amazon Textract for OCR processing (no local Tesseract dependency).
"""

import re
import hashlib
from datetime import datetime
from io import BytesIO
from typing import List, Optional, Tuple
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError, BotoCoreError
from PIL import Image

from app.config import (
    MIN_OCR_CONFIDENCE,
    ALLOWED_APPS,
    S3_BUCKET_NAME,
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    PAYMENT_SCREENSHOT_TIMEZONE,
    PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS,
    PAYMENT_VERIFICATION_TIME_GRACE_SECONDS,
)
from app.constants.ocr_constants import (
    APP_BHIM,
    APP_GPAY,
    APP_PAYTM,
    APP_UNKNOWN,
    DEFAULT_SCREENSHOT_TIMEZONE,
    DISALLOWED_APP_PATTERNS,
    FAILURE_INVALID_AMOUNT,
    FAILURE_INVALID_BANKING_NAME,
    FAILURE_INVALID_DATETIME_BHIM,
    FAILURE_INVALID_DATETIME_GPAY,
    FAILURE_INVALID_DATETIME_PAYTM,
    FAILURE_MISSING_BHIM_LABEL,
    FAILURE_MISSING_PAID_BHIM,
    FAILURE_MISSING_PAID_TO_COGNIT,
    FAILURE_MISSING_PAYTM_LABEL,
    FAILURE_TIME_OUT_OF_RANGE,
    FAILURE_UNRECOGNIZED_APP,
    IMAGE_FORMAT_PNG,
    MONTH_FULL,
    MONTH_SHORT,
    REGEX_AMOUNT,
    REGEX_BHIM_DATE,
    REGEX_BHIM_LABEL,
    REGEX_GAURAV,
    REGEX_GOOGLE_PAY,
    REGEX_GPAY_APP,
    REGEX_GPAY_DATE,
    REGEX_PAID,
    REGEX_PAID_GAURAV,
    REGEX_PAID_TO_COGNIT,
    REGEX_PAID_TO_GAURAV,
    REGEX_PAYTM_DATE_DAY_FIRST,
    REGEX_PAYTM_DATE_MONTH_FIRST,
    REGEX_PAYTM_LABEL,
    REGEX_TIME_12H,
    TEXTRACT_SERVICE_NAME,
)
from app.extensions import s3


# ────────────────────────────────────────────────
# Textract Client Setup
# ────────────────────────────────────────────────

_textract_client = None


def _get_textract_client():
    """Lazy initialization of Textract client with proper error handling."""
    global _textract_client
    if _textract_client is None:
        if not AWS_ACCESS_KEY_ID or not AWS_SECRET_ACCESS_KEY:
            raise OCRServiceUnavailableError("AWS credentials not configured")
        try:
            _textract_client = boto3.client(
                TEXTRACT_SERVICE_NAME,
                region_name=AWS_REGION,
                aws_access_key_id=AWS_ACCESS_KEY_ID,
                aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            )
        except (ClientError, BotoCoreError) as e:
            raise OCRServiceUnavailableError(f"Failed to initialize Textract client: {str(e)}")
    return _textract_client


# ────────────────────────────────────────────────
# Custom Exceptions for OCR Service
# ────────────────────────────────────────────────

class OCRServiceUnavailableError(Exception):
    """Raised when OCR service is not available (AWS Textract unreachable or misconfigured)."""
    pass


class OCRServiceError(Exception):
    """Raised when OCR service fails during text extraction."""
    pass


class TesseractNotFoundError(OCRServiceUnavailableError):
    """Legacy alias for OCRServiceUnavailableError for backward compatibility."""
    pass


# ────────────────────────────────────────────────
# S3 Image Fetching
# ────────────────────────────────────────────────

def fetch_s3_image(object_key: str) -> Image.Image:
    """
    Fetch image from S3 bucket.

    Args:
        object_key: S3 object key path

    Returns:
        PIL Image object
    """
    obj = s3.get_object(Bucket=S3_BUCKET_NAME, Key=object_key)
    file_bytes = obj["Body"].read()
    return Image.open(BytesIO(file_bytes))


# ────────────────────────────────────────────────
# Text Extraction with Confidence using Textract
# ────────────────────────────────────────────────

def extract_text_with_confidence(image: Image.Image) -> Tuple[str, float]:
    """
    Extract text from image using Amazon Textract with confidence score.

    Args:
        image: PIL Image object

    Returns:
        Tuple of (extracted_text, average_confidence)

    Raises:
        OCRServiceUnavailableError: If Textract service is not reachable
        OCRServiceError: If text extraction fails
    """
    try:
        textract = _get_textract_client()
    except OCRServiceUnavailableError:
        raise
    except Exception as e:
        raise OCRServiceUnavailableError(f"Textract client initialization failed: {str(e)}")

    try:
        # Convert PIL image to bytes
        buffer = BytesIO()
        image.save(buffer, format=IMAGE_FORMAT_PNG)
        image_bytes = buffer.getvalue()

        response = textract.detect_document_text(
            Document={"Bytes": image_bytes}
        )

        blocks = response.get("Blocks", [])

        words = []
        confidences = []

        for block in blocks:
            if block.get("BlockType") == "WORD":
                text = block.get("Text", "").strip()
                confidence = block.get("Confidence", 0)
                if text:
                    words.append(text)
                    confidences.append(confidence)

        if not words:
            return "", 0.0

        extracted_text = " ".join(words)
        avg_confidence = sum(confidences) / len(confidences)

        return extracted_text, avg_confidence

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        if error_code in ("ThrottlingException", "ProvisionedThroughputExceededException"):
            raise OCRServiceUnavailableError(f"Textract rate limited: {error_code}")
        raise OCRServiceError(f"Textract API error: {error_code}")
    except BotoCoreError as e:
        raise OCRServiceUnavailableError(f"Textract connection error: {str(e)}")
    except Exception as e:
        raise OCRServiceError(f"Textract OCR failed: {str(e)}")


# ────────────────────────────────────────────────
# UPI App Detection
# ────────────────────────────────────────────────

def detect_upi_app(text: str) -> Optional[str]:
    """
    Detect which UPI app from the allowed whitelist.

    Args:
        text: OCR extracted text

    Returns:
        App name key or None if unrecognized
    """
    lower = text.lower()
    for app, keywords in ALLOWED_APPS.items():
        if any(k in lower for k in keywords):
            return app
    return None


# ────────────────────────────────────────────────
# VPA Normalization
# ────────────────────────────────────────────────

# ────────────────────────────────────────────────
# Payment Screenshot Verification
# ────────────────────────────────────────────────

def _extract_timestamp(text: str, app: str) -> Optional[datetime]:
    """
    Extract app-specific timestamp from OCR text.
    Rules:
    - gpay: DD FullMonth YYYY + HH:MM AM/PM
    - paytm: DD Mon (YY|YYYY) + HH:MM AM/PM
    - bhim: DD(st|nd|rd|th) Mon YY + HH:MM AM/PM
    """
    from datetime import datetime

    lower = text.lower()
    try:
        local_tz = ZoneInfo(PAYMENT_SCREENSHOT_TIMEZONE)
    except Exception:
        local_tz = ZoneInfo(DEFAULT_SCREENSHOT_TIMEZONE)

    # Supports zero-padded and non-padded HH:MM with AM/PM (case-insensitive)
    time_match = REGEX_TIME_12H.search(lower)
    if not time_match:
        return None
    hour = int(time_match.group(1))
    minute = int(time_match.group(2))
    ampm = time_match.group(3).lower()
    if ampm == "pm" and hour != 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0

    day = month = year = None

    if app == APP_GPAY:
        # Examples: 03 January 2026, 3 january 2026
        m = REGEX_GPAY_DATE.search(lower)
        if not m:
            return None
        day = int(m.group(1))
        month = MONTH_FULL[m.group(2).lower()]
        year = int(m.group(3))
    elif app == APP_PAYTM:
        # Examples: 03 Jan 2026, 3 jan 26, Jan 03 2026, 20 Mar 07:54 PM
        m = REGEX_PAYTM_DATE_DAY_FIRST.search(lower)
        if not m:
            m = REGEX_PAYTM_DATE_MONTH_FIRST.search(lower)
            if not m:
                return None
            month = MONTH_SHORT[m.group(1).lower()]
            day = int(m.group(2))
            year_str = m.group(3)
            year = int(year_str) if year_str else datetime.now(local_tz).year
        else:
            day = int(m.group(1))
            month = MONTH_SHORT[m.group(2).lower()]
            year_str = m.group(3)
            year = int(year_str) if year_str else datetime.now(local_tz).year
        if year < 100:
            year += 2000
    else:  # bhim
        # Example: 03rd Jan 26, 3rd jan 26
        m = REGEX_BHIM_DATE.search(lower)
        if not m:
            return None
        day = int(m.group(1))
        month = MONTH_SHORT[m.group(3).lower()]
        year = int(m.group(4)) + 2000

    try:
        return datetime(year, month, day, hour, minute, tzinfo=local_tz)
    except ValueError:
        return None


def _is_datetime_ambiguous(text: str, app: str) -> bool:
    """Return True when multiple conflicting date/time candidates are detected."""
    lower = text.lower()
    time_matches = REGEX_TIME_12H.findall(lower)
    if len(set(time_matches)) > 1:
        return True

    if app == APP_GPAY:
        date_matches = REGEX_GPAY_DATE.findall(lower)
        return len(set(date_matches)) > 1
    if app == APP_PAYTM:
        matches_a = REGEX_PAYTM_DATE_DAY_FIRST.findall(lower)
        matches_b = REGEX_PAYTM_DATE_MONTH_FIRST.findall(lower)
        normalized = set(matches_a) | set((d, m, y) for (m, d, y) in matches_b)
        return len(normalized) > 1

    # bhim
    date_matches = REGEX_BHIM_DATE.findall(lower)
    return len(set(date_matches)) > 1


def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    confidence: float,
    expected_upi_name: str,
    time_window_start_utc: Optional[datetime] = None,
    time_window_end_utc: Optional[datetime] = None,
) -> Tuple[bool, Optional[str], List[str]]:
    """
    Validate UPI payment screenshot with app-specific and global rules.

    App-specific rules:
    - Google Pay: app label not required, must include a supported recipient phrase
      such as "paid to cognit", "paid gaurav", or "paid to gaurav",
      full-month-name + 4-digit-year date, and HH:MM AM/PM
    - Paytm: "paytm" label required, short-month-name date, and HH:MM AM/PM
    - BHIM: "bhim" label + "paid" required, ordinal day date (st/nd/rd/th)
      with short month + 2-digit year, and HH:MM AM/PM

    Global rules (apply to all apps):
    - Banking name: Must contain "gaurav" (case-insensitive)
    - Amount: Must contain "₹" and "1" (case insensitive for Rs/rs)
    - Time: Within configured window of NOW (absolute difference <= PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS)

    Args:
        image: PIL Image object
        text: OCR extracted text
        expected_amount: Expected payment amount (unused, amount must be ₹1)
        confidence: OCR confidence score (unused for validation)
        expected_upi_name: Expected UPI recipient name from config (unused, uses "Gaurav")

    Returns:
        Tuple of (is_valid, detected_app, failure_reasons)
    """
    from datetime import datetime, timezone

    failures = []
    lower = text.lower()

    has_paytm = REGEX_PAYTM_LABEL.search(lower) is not None
    has_bhim = REGEX_BHIM_LABEL.search(lower) is not None
    has_paid_to_cognit = REGEX_PAID_TO_COGNIT.search(lower) is not None
    has_paid_to_gaurav = REGEX_PAID_TO_GAURAV.search(lower) is not None
    has_paid_gaurav = REGEX_PAID_GAURAV.search(lower) is not None
    has_gpay_recipient_phrase = (
        has_paid_to_cognit
        or has_paid_to_gaurav
        or has_paid_gaurav
        or has_paid_to_gaurav
    )

    if has_paytm:
        detected_app = APP_PAYTM
    elif has_bhim:
        detected_app = APP_BHIM
    elif has_gpay_recipient_phrase:
        detected_app = APP_GPAY
    else:
        detected_app = APP_UNKNOWN

    # Explicitly reject known non-allowed app names if present.
    if any(pattern.search(lower) for pattern in DISALLOWED_APP_PATTERNS):
        failures.append(FAILURE_UNRECOGNIZED_APP)
        return False, APP_UNKNOWN, failures

    if detected_app == APP_UNKNOWN:
        failures.append(FAILURE_UNRECOGNIZED_APP)
        return False, detected_app, failures

    # Enforce OCR confidence floor after app detection.
    # Return unrecognized_app for low-confidence reads to keep user-facing messaging
    # focused on unsupported/unreadable payment app evidence.
    if confidence < MIN_OCR_CONFIDENCE:
        failures.append(FAILURE_UNRECOGNIZED_APP)
        return False, detected_app, failures

    # App-specific rules
    if detected_app == APP_GPAY:
        if not has_gpay_recipient_phrase:
            failures.append(FAILURE_MISSING_PAID_TO_COGNIT)
    elif detected_app == APP_PAYTM:
        if not has_paytm:
            failures.append(FAILURE_MISSING_PAYTM_LABEL)
    elif detected_app == APP_BHIM:
        if not has_bhim:
            failures.append(FAILURE_MISSING_BHIM_LABEL)
        if REGEX_PAID.search(lower) is None:
            failures.append(FAILURE_MISSING_PAID_BHIM)

    # ─────────────────────────────────────────────
    # Global Rules (apply to all apps)
    # ─────────────────────────────────────────────

    # Rule 1: Banking name must contain strict token "gaurav" (case-insensitive).
    if REGEX_GAURAV.search(lower) is None:
        failures.append(FAILURE_INVALID_BANKING_NAME)

    # Rule 2: Amount must be exactly ₹1 / Rs.1 / rs 1 (optionally 1.00).
    if REGEX_AMOUNT.search(lower) is None:
        failures.append(FAILURE_INVALID_AMOUNT)

    # Rule 3: app-specific date+time must be parsable/unambiguous and within
    # either the payment session window (preferred) or fallback absolute diff window.
    if _is_datetime_ambiguous(text, detected_app):
        if detected_app == APP_GPAY:
            failures.append(FAILURE_INVALID_DATETIME_GPAY)
        elif detected_app == APP_PAYTM:
            failures.append(FAILURE_INVALID_DATETIME_PAYTM)
        else:
            failures.append(FAILURE_INVALID_DATETIME_BHIM)
    else:
        transaction_time = _extract_timestamp(text, detected_app)
        if transaction_time:
            transaction_time_utc = transaction_time.astimezone(timezone.utc)
            grace = max(0, int(PAYMENT_VERIFICATION_TIME_GRACE_SECONDS))

            if time_window_start_utc and time_window_end_utc:
                start_utc = time_window_start_utc
                end_utc = time_window_end_utc

                if start_utc.tzinfo is None:
                    start_utc = start_utc.replace(tzinfo=timezone.utc)
                if end_utc.tzinfo is None:
                    end_utc = end_utc.replace(tzinfo=timezone.utc)

                txn_ts = transaction_time_utc.timestamp()
                if txn_ts < (start_utc.timestamp() - grace) or txn_ts > (end_utc.timestamp() + grace):
                    failures.append(FAILURE_TIME_OUT_OF_RANGE)
            else:
                now = datetime.now(timezone.utc)
                time_diff = abs((now - transaction_time_utc).total_seconds())
                if time_diff > PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS:
                    failures.append(FAILURE_TIME_OUT_OF_RANGE)
        else:
            if detected_app == APP_GPAY:
                failures.append(FAILURE_INVALID_DATETIME_GPAY)
            elif detected_app == APP_PAYTM:
                failures.append(FAILURE_INVALID_DATETIME_PAYTM)
            else:
                failures.append(FAILURE_INVALID_DATETIME_BHIM)

    return len(failures) == 0, detected_app, failures


def sanitize_extracted_text_for_storage(
    text: str,
    detected_app: Optional[str]
) -> str:
    """
    Keep only verification-relevant OCR snippets for DB storage.
    This avoids saving unrelated/noisy OCR words in payments.extracted_text.
    """
    if not text:
        return ""

    kept_parts: List[str] = []

    def add_match(pattern: str):
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(0).strip()
            if value and value not in kept_parts:
                kept_parts.append(value)

    # App markers
    add_match(REGEX_PAYTM_LABEL.pattern)
    add_match(REGEX_BHIM_LABEL.pattern)
    add_match(REGEX_GPAY_APP.pattern)
    add_match(REGEX_GOOGLE_PAY.pattern)

    # Core payment semantics
    add_match(REGEX_PAID_TO_COGNIT.pattern)
    add_match(REGEX_PAID_TO_GAURAV.pattern)
    add_match(REGEX_PAID_GAURAV.pattern)
    add_match(REGEX_PAID.pattern)
    add_match(r"\bcognit\b")
    add_match(REGEX_GAURAV.pattern)
    add_match(REGEX_AMOUNT.pattern)

    # Time
    add_match(REGEX_TIME_12H.pattern)

    # Date by detected app
    if detected_app == APP_GPAY:
        add_match(REGEX_GPAY_DATE.pattern)
    elif detected_app == APP_PAYTM:
        add_match(REGEX_PAYTM_DATE_DAY_FIRST.pattern)
        add_match(REGEX_PAYTM_DATE_MONTH_FIRST.pattern)
    elif detected_app == APP_BHIM:
        add_match(REGEX_BHIM_DATE.pattern)

    # Deterministic compact output
    return " | ".join(kept_parts)


def compute_ocr_signature(text: str, detected_app: Optional[str]) -> Optional[str]:
    """
    Build a deterministic hash of verification-relevant OCR evidence.
    Used to detect edited/replayed screenshots with different pixels but
    effectively identical transaction text.
    """
    sanitized = sanitize_extracted_text_for_storage(text or "", detected_app or APP_UNKNOWN)
    normalized = re.sub(r"\s+", " ", (sanitized or "").strip().lower())
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
