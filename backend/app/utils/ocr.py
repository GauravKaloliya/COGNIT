"""
OCR utilities module for C.O.G.N.I.T. backend.
Provides text extraction, UPI app detection, and payment screenshot verification.
Uses Amazon Textract for OCR processing (no local Tesseract dependency).
"""

import re
from datetime import datetime
from io import BytesIO
from typing import List, Optional, Tuple

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


def extract_text_from_s3(object_key: str) -> Tuple[str, float]:
    """
    Extract text directly from S3 image using Amazon Textract.

    Args:
        object_key: S3 object key path in the configured bucket

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
        response = textract.detect_document_text(
            Document={
                "S3Object": {
                    "Bucket": S3_BUCKET_NAME,
                    "Name": object_key
                }
            }
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
        raise OCRServiceError(f"Textract API error for S3 object {object_key}: {error_code}")
    except BotoCoreError as e:
        raise OCRServiceUnavailableError(f"Textract connection error: {str(e)}")
    except Exception as e:
        raise OCRServiceError(f"Textract OCR failed for S3 object {object_key}: {str(e)}")


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

def normalize_vpa(text: str) -> str:
    """
    Normalize VPA for comparison by removing special characters.

    Args:
        text: Text containing VPA

    Returns:
        Normalized lowercase VPA string
    """
    return re.sub(r'[^a-z0-9@.]', '', text.lower())


# ────────────────────────────────────────────────
# Payment Screenshot Verification
# ────────────────────────────────────────────────

def _extract_timestamp(text: str) -> Optional[datetime]:
    """
    Extract date and time from OCR text.
    Supports various formats from different UPI apps:
    - Full month names: January, February, etc.
    - Short month names: Jan, Feb, etc.
    - Ordinal dates: 1st, 2nd, 3rd, 4th, etc.
    - Zero-padded formats: 01, 02, etc.
    - Time: HH:MM AM/PM format

    Returns:
        datetime object with timezone or None if not found
    """
    from datetime import datetime, timezone

    lower = text.lower()

    # Strip ordinal suffixes for BHIM (1st, 2nd, 3rd, 4th, etc.)
    text_for_date = re.sub(r'(\d+)(st|nd|rd|th)\s+', r'\1 ', text)
    text_for_date = re.sub(r'(\d+)(st|nd|rd|th),', r'\1,', text_for_date)
    lower_for_date = text_for_date.lower()

    # Month name mappings - use short names as keys, look up by first 3 chars
    month_names_short = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                         'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    month_names_full = ['january', 'february', 'march', 'april', 'may', 'june',
                        'july', 'august', 'september', 'october', 'november', 'december']
    # Create map from full names too (first 3 chars will map correctly)
    month_map = {name: idx + 1 for idx, name in enumerate(month_names_short)}
    for name in month_names_full:
        short = name[:3]
        if short not in month_map:
            month_map[short] = month_names_short.index(short) + 1

    day, month, year = None, None, None

    # Pattern 1: DD MMM YYYY (e.g., "15 Jan 2026" or "15 January 2026")
    pattern = r'(\d{1,2})\s+([a-z]+)\s+(\d{2,4})'
    match = re.search(pattern, lower_for_date)
    if match:
        day = int(match.group(1))
        month_name = match.group(2).lower()[:3]  # Take first 3 chars
        if month_name in month_map:
            month = month_map[month_name]
            year = int(match.group(3))
            if year < 100:
                year += 2000

    # Pattern 2: MMM DD, YYYY (e.g., "Jan 15, 2026" or "January 15, 2026")
    if month is None:
        pattern = r'([a-z]+)\s+(\d{1,2}),?\s+(\d{2,4})'
        match = re.search(pattern, lower_for_date)
        if match:
            month_name = match.group(1).lower()[:3]
            if month_name in month_map:
                month = month_map[month_name]
                day = int(match.group(2))
                year = int(match.group(3))
                if year < 100:
                    year += 2000

    # Pattern 3: DD/MM/YYYY or DD-MM-YYYY (numeric date)
    if month is None:
        pattern = r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})'
        match = re.search(pattern, lower_for_date)
        if match:
            day = int(match.group(1))
            month = int(match.group(2))
            year = int(match.group(3))
            if year < 100:
                year += 2000

    # Extract time - HH:MM AM/PM format (case insensitive)
    hour, minute = None, None
    time_patterns = [
        r'(\d{1,2}):(\d{2})\s*(am|pm)',  # HH:MM AM/PM
        r'(\d{1,2}):(\d{2})(?:\s|$)',     # HH:MM (24-hour)
    ]

    for pattern in time_patterns:
        match = re.search(pattern, lower, re.IGNORECASE)
        if match:
            hour = int(match.group(1))
            minute = int(match.group(2))
            ampm = match.group(3).lower() if len(match.groups()) >= 3 and match.group(3) else None

            # Handle AM/PM conversion
            if ampm == 'pm' and hour != 12:
                hour += 12
            elif ampm == 'am' and hour == 12:
                hour = 0
            break

    # If we have time but no date, use current date as fallback
    if day is None and hour is not None:
        if 'today' in lower:
            now = datetime.now(timezone.utc)
            day = now.day
            month = now.month
            year = now.year
        elif 'yesterday' in lower:
            from datetime import timedelta
            yesterday = datetime.now(timezone.utc) - timedelta(days=1)
            day = yesterday.day
            month = yesterday.month
            year = yesterday.year

    if day is not None and month is not None and year is not None and hour is not None and minute is not None:
        try:
            return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        except ValueError:
            return None

    return None


def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    payment_note: str,
    confidence: float,
    expected_upi_name: str
) -> Tuple[bool, Optional[str], List[str]]:
    """
    Validate UPI payment screenshot with app-specific and global rules.

    App-specific rules:
    - Paytm: Must contain "paytm", Short month name date
    - BHIM: Must contain "bhim" AND "paid", Ordinal date format (1st, 2nd, etc.)
    - Google Pay: No app name check (Google Pay screenshots don't show app name)

    Global rules (apply to all apps):
    - Banking name: Must contain "gaurav" (case insensitive)
    - Amount: Must contain "₹" and "1" (case insensitive for Rs/rs)
    - Time: Within 5 minutes of NOW (absolute difference ≤ 300 seconds)

    Note: Transaction ID / Reference ID checking is NOT performed in this function.

    Args:
        image: PIL Image object
        text: OCR extracted text
        expected_amount: Expected payment amount (unused, amount must be ₹1)
        payment_note: Expected payment note/reference (unused)
        confidence: OCR confidence score (unused for validation)
        expected_upi_name: Expected UPI recipient name from config (unused, uses "Gaurav")

    Returns:
        Tuple of (is_valid, detected_app, failure_reasons)
    """
    from datetime import datetime, timezone, timedelta

    failures = []
    lower = text.lower()

    # Detect which UPI app - case insensitive matching
    detected_app = None

    # Check for Paytm - must have "paytm"
    has_paytm = re.search(r'paytm', lower) is not None

    # Check for BHIM - must have "bhim"
    has_bhim = re.search(r'bhim', lower) is not None

    # Note: Google Pay screenshots don't show app name, so we don't check for it
    # Google Pay will be treated as unrecognized but will pass if global rules pass

    # Determine app and apply app-specific rules
    if has_paytm:
        # Paytm - must have "paytm" visible
        detected_app = "paytm"

        # Paytm: Check for short month name (Jan, Feb, etc. - NOT full month names)
        # Full month names: January, February, etc.
        full_months = r'(january|february|march|april|may|june|july|august|september|october|november|december)'
        has_full_month = re.search(full_months, lower) is not None

        # Short month names: Jan, Feb, etc.
        short_months = r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b'
        has_short_month = re.search(short_months, lower) is not None

        if has_full_month and not has_short_month:
            failures.append("invalid_date_format_paytm")
    elif has_bhim:
        # BHIM - must have "bhim" AND "paid"
        detected_app = "bhim"

        # Check for "paid" keyword
        if 'paid' not in lower:
            failures.append("missing_paid_bhim")

        # BHIM: Check for ordinal date format (1st, 2nd, 3rd, 4th, etc.)
        ordinal_pattern = r'(\d{1,2})(st|nd|rd|th)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)'
        has_ordinal = re.search(ordinal_pattern, lower) is not None

        if not has_ordinal:
            failures.append("invalid_date_format_bhim")
    # Google Pay: No app name check - let it pass to global rules
    # If neither Paytm nor BHIM, assume it could be Google Pay (or other UPI app)
    # and apply only global rules

    # ─────────────────────────────────────────────
    # Global Rules (apply to all apps)
    # ─────────────────────────────────────────────

    # Rule 1: Banking name must contain "gaurav" (case insensitive)
    # Note: This ignores expected_upi_name parameter
    if 'gaurav' not in lower:
        failures.append("invalid_banking_name")

    # Rule 2: Amount must contain "₹" and "1" (case insensitive)
    # Look for ₹ symbol or Rs/rs text along with "1"
    has_rupee_symbol = '₹' in text or 'rs' in lower.replace('prs', '').replace('crs', '')
    has_one = '1' in text or 'one' in lower

    if not (has_rupee_symbol and has_one):
        failures.append("invalid_amount")

    # Rule 3: Time must be within 5 minutes of NOW
    transaction_time = _extract_timestamp(text)
    if transaction_time:
        now = datetime.now(timezone.utc)
        time_diff = abs((now - transaction_time).total_seconds())
        if time_diff > 300:  # 5 minutes = 300 seconds
            failures.append("time_out_of_range")
    else:
        # Could not extract timestamp - consider it a failure
        failures.append("missing_timestamp")

    return len(failures) == 0, detected_app, failures


# ────────────────────────────────────────────────
# UPI Reference Extraction
# ────────────────────────────────────────────────

def extract_upi_ref(text: str) -> Optional[str]:
    """
    Extract UPI transaction reference from OCR text.
    Uses the same patterns as verify_payment_screenshot for consistency.

    Args:
        text: OCR extracted text

    Returns:
        UPI reference number or None
    """
    # Google Pay: 12-digit numeric (e.g., "312456789012")
    # PhonePe: 12-16 character alphanumeric
    # Paytm: 12-16 character alphanumeric
    # BHIM: 12-16 character alphanumeric
    txn_patterns = [
        r'\b\d{12}\b',                    # 12-digit numeric (Google Pay)
        r'\b[a-zA-Z0-9]{12,16}\b',        # 12-16 alphanumeric (most UPI apps)
        r'\b\d{10,16}\b',                 # 10-16 digit numeric
    ]

    for pattern in txn_patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(0)

    # If not found, try with spaces/dashes removed
    cleaned_text = re.sub(r'[\s\-]', '', text)
    for pattern in txn_patterns:
        match = re.search(pattern, cleaned_text)
        if match:
            return match.group(0)

    return None
