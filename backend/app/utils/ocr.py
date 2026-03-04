"""
OCR utilities module for C.O.G.N.I.T. backend.
Provides text extraction, UPI app detection, and payment screenshot verification.
Uses Amazon Textract for OCR processing (no local Tesseract dependency).
"""

import re
from datetime import datetime
from io import BytesIO
from typing import List, Optional, Tuple
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError, BotoCoreError
from PIL import Image

from app.config import (
    MIN_IMAGE_WIDTH,
    MIN_OCR_CONFIDENCE,
    ALLOWED_APPS,
    SUCCESS_KEYWORDS,
    FAILURE_KEYWORDS,
    UPI_VPA,
    S3_BUCKET_NAME,
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    PAYMENT_SCREENSHOT_TIMEZONE,
    PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS,
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
                "textract",
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
        image.save(buffer, format="PNG")
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
        local_tz = ZoneInfo("Asia/Kolkata")

    month_full = {
        "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
        "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    }
    month_short = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }

    # Supports zero-padded and non-padded HH:MM with AM/PM (case-insensitive)
    time_match = re.search(r"\b(0?[1-9]|1[0-2]):([0-5][0-9])\s*(am|pm)\b", lower, re.IGNORECASE)
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

    if app == "gpay":
        # Examples: 03 January 2026, 3 january 2026
        m = re.search(
            r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
            r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+"
            r"(\d{4})\b",
            lower,
            re.IGNORECASE,
        )
        if not m:
            return None
        day = int(m.group(1))
        month = month_full[m.group(2).lower()]
        year = int(m.group(3))
    elif app == "paytm":
        # Examples: 03 Jan 2026, 3 jan 26, Jan 03 2026
        m = re.search(
            r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(\d{2}|\d{4})\b",
            lower,
            re.IGNORECASE,
        )
        if not m:
            m = re.search(
                r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
                r"(0?[1-9]|[12][0-9]|3[01]),?\s+"
                r"(\d{2}|\d{4})\b",
                lower,
                re.IGNORECASE,
            )
            if not m:
                return None
            month = month_short[m.group(1).lower()]
            day = int(m.group(2))
            year = int(m.group(3))
        else:
            day = int(m.group(1))
            month = month_short[m.group(2).lower()]
            year = int(m.group(3))
        if year < 100:
            year += 2000
    else:  # bhim
        # Example: 03rd Jan 26, 3rd jan 26
        m = re.search(
            r"\b(0?[1-9]|[12][0-9]|3[01])(st|nd|rd|th)\s+"
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(\d{2})\b",
            lower,
            re.IGNORECASE,
        )
        if not m:
            return None
        day = int(m.group(1))
        month = month_short[m.group(3).lower()]
        year = int(m.group(4)) + 2000

    try:
        return datetime(year, month, day, hour, minute, tzinfo=local_tz)
    except ValueError:
        return None


def _is_datetime_ambiguous(text: str, app: str) -> bool:
    """Return True when multiple conflicting date/time candidates are detected."""
    lower = text.lower()
    time_matches = re.findall(r"\b(0?[1-9]|1[0-2]):([0-5][0-9])\s*(am|pm)\b", lower, re.IGNORECASE)
    if len(set(time_matches)) > 1:
        return True

    if app == "gpay":
        date_matches = re.findall(
            r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
            r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+"
            r"(\d{4})\b",
            lower,
            re.IGNORECASE,
        )
        return len(set(date_matches)) > 1
    if app == "paytm":
        matches_a = re.findall(
            r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(\d{2}|\d{4})\b",
            lower,
            re.IGNORECASE,
        )
        matches_b = re.findall(
            r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(0?[1-9]|[12][0-9]|3[01]),?\s+"
            r"(\d{2}|\d{4})\b",
            lower,
            re.IGNORECASE,
        )
        normalized = set(matches_a) | set((d, m, y) for (m, d, y) in matches_b)
        return len(normalized) > 1

    # bhim
    date_matches = re.findall(
        r"\b(0?[1-9]|[12][0-9]|3[01])(st|nd|rd|th)\s+"
        r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
        r"(\d{2})\b",
        lower,
        re.IGNORECASE,
    )
    return len(set(date_matches)) > 1


def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    confidence: float,
    expected_upi_name: str
) -> Tuple[bool, Optional[str], List[str]]:
    """
    Validate UPI payment screenshot with app-specific and global rules.

    App-specific rules:
    - Google Pay: app label not required, must include "paid to cognit",
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

    has_paytm = re.search(r"\bpaytm\b", lower, re.IGNORECASE) is not None
    has_bhim = re.search(r"\bbhim\b", lower, re.IGNORECASE) is not None
    has_paid_to_cognit = re.search(r"paid\s+to\s+cognit", lower, re.IGNORECASE) is not None

    if has_paytm:
        detected_app = "paytm"
    elif has_bhim:
        detected_app = "bhim"
    elif has_paid_to_cognit:
        detected_app = "gpay"
    else:
        detected_app = "unknown"

    # Explicitly reject known non-allowed app names if present.
    disallowed_app_markers = [
        r"\bphone\s*pe\b", r"\bphonepe\b",
        r"\bamazon\s*pay\b", r"\bamazonpay\b",
        r"\bbharat\s*pe\b", r"\bbharatpe\b",
    ]
    if any(re.search(p, lower, re.IGNORECASE) for p in disallowed_app_markers):
        failures.append("unrecognized_app")
        return False, "unknown", failures

    # Enforce OCR confidence floor.
    if confidence < MIN_OCR_CONFIDENCE:
        failures.append("ocr_unavailable")
        return False, detected_app, failures

    if detected_app == "unknown":
        failures.append("unrecognized_app")
        return False, detected_app, failures

    # App-specific rules
    if detected_app == "gpay":
        if not has_paid_to_cognit:
            failures.append("missing_paid_to_cognit")
    elif detected_app == "paytm":
        if not has_paytm:
            failures.append("missing_paytm_label")
    elif detected_app == "bhim":
        if not has_bhim:
            failures.append("missing_bhim_label")
        if re.search(r"\bpaid\b", lower, re.IGNORECASE) is None:
            failures.append("missing_paid_bhim")

    # ─────────────────────────────────────────────
    # Global Rules (apply to all apps)
    # ─────────────────────────────────────────────

    # Rule 1: Banking name must contain strict token "gaurav" (case-insensitive).
    if re.search(r"\bgaurav\b", lower, re.IGNORECASE) is None:
        failures.append("invalid_banking_name")

    # Rule 2: Amount must be exactly ₹1 / Rs.1 / rs 1 (optionally 1.00).
    if re.search(r"(?:₹\s*1(?:\.00)?\b|rs\.?\s*1(?:\.00)?\b)", lower, re.IGNORECASE) is None:
        failures.append("invalid_amount")

    # Rule 3: app-specific date+time must be parsable/unambiguous and within 5 minutes.
    if _is_datetime_ambiguous(text, detected_app):
        if detected_app == "gpay":
            failures.append("invalid_datetime_format_gpay")
        elif detected_app == "paytm":
            failures.append("invalid_datetime_format_paytm")
        else:
            failures.append("invalid_datetime_format_bhim")
    else:
        transaction_time = _extract_timestamp(text, detected_app)
        if transaction_time:
            now = datetime.now(timezone.utc)
            transaction_time_utc = transaction_time.astimezone(timezone.utc)
            time_diff = abs((now - transaction_time_utc).total_seconds())
            if time_diff > PAYMENT_VERIFICATION_MAX_TIME_DIFF_SECONDS:
                failures.append("time_out_of_range")
        else:
            if detected_app == "gpay":
                failures.append("invalid_datetime_format_gpay")
            elif detected_app == "paytm":
                failures.append("invalid_datetime_format_paytm")
            else:
                failures.append("invalid_datetime_format_bhim")

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

    lower = text.lower()
    kept_parts: List[str] = []

    def add_match(pattern: str):
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(0).strip()
            if value and value not in kept_parts:
                kept_parts.append(value)

    # App markers
    add_match(r"\bpaytm\b")
    add_match(r"\bbhim\b")
    add_match(r"\bgpay\b")
    add_match(r"\bgoogle\s*pay\b")

    # Core payment semantics
    add_match(r"paid\s+to\s+cognit")
    add_match(r"\bpaid\b")
    add_match(r"\bcognit\b")
    add_match(r"\bgaurav\b")
    add_match(r"(?:₹\s*1(?:\.00)?\b|rs\.?\s*1(?:\.00)?\b)")

    # Time
    add_match(r"\b(0?[1-9]|1[0-2]):([0-5][0-9])\s*(am|pm)\b")

    # Date by detected app
    if detected_app == "gpay":
        add_match(
            r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
            r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+"
            r"(\d{4})\b"
        )
    elif detected_app == "paytm":
        add_match(
            r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(\d{2}|\d{4})\b"
        )
        add_match(
            r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(0?[1-9]|[12][0-9]|3[01]),?\s+"
            r"(\d{2}|\d{4})\b"
        )
    elif detected_app == "bhim":
        add_match(
            r"\b(0?[1-9]|[12][0-9]|3[01])(st|nd|rd|th)\s+"
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
            r"(\d{2})\b"
        )

    # Deterministic compact output
    return " | ".join(kept_parts)
