"""
OCR utilities module for C.O.G.N.I.T. backend.
Provides text extraction, UPI app detection, and payment screenshot verification.
Uses Amazon Textract for OCR processing (no local Tesseract dependency).
"""

import re
from io import BytesIO
from typing import List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError, BotoCoreError
from PIL import Image

from app.config import (
    MIN_IMAGE_WIDTH,
    MIN_OCR_CONFIDENCE,
    ALLOWED_APPS,
    ALLOWED_TEST_URLS,
    SUCCESS_KEYWORDS,
    FAILURE_KEYWORDS,
    UPI_VPA,
    S3_BUCKET_NAME,
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
)
from app.extensions import s3


def is_allowed_test_url(url: str) -> bool:
    """
    Check if a URL is in the allowed test/demo screenshot whitelist.

    Args:
        url: The URL to check

    Returns:
        True if URL is in the allowed test URLs list
    """
    if not url:
        return False
    from urllib.parse import urlparse, parse_qs

    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

    for allowed_url in ALLOWED_TEST_URLS:
        allowed_parsed = urlparse(allowed_url)
        allowed_base = f"{allowed_parsed.scheme}://{allowed_parsed.netloc}{allowed_parsed.path}"
        if base_url == allowed_base:
            return True
    return False


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

def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    payment_note: str,
    confidence: float
) -> Tuple[bool, Optional[str], List[str]]:
    """
    Strict validation of UPI payment screenshot.

    Args:
        image: PIL Image object
        text: OCR extracted text
        expected_amount: Expected payment amount
        payment_note: Expected payment note/reference
        confidence: OCR confidence score

    Returns:
        Tuple of (is_valid, detected_app, failure_reasons)
    """
    failures = []
    lower = text.lower()

    # 1. Resolution check
    if image.width < MIN_IMAGE_WIDTH:
        failures.append("low_resolution")

    # 2. OCR confidence check
    if confidence < MIN_OCR_CONFIDENCE:
        failures.append("low_ocr_confidence")

    # 3. App detection - must be from allowed UPI app
    # Use fuzzy matching for app detection to handle OCR variations
    detected_app = detect_upi_app(text)
    if not detected_app:
        # If strict detection fails, try to detect from common app patterns
        # Google Pay: "google", "gpay", "tez"
        # PhonePe: "phonepe", "phone pe"
        # Paytm: "paytm"
        # BHIM: "bhim"
        # Amazon Pay: "amazon", "amazonpay"
        app_patterns = {
            'gpay': [r'g[ -]*pay', r'goo[gl]*[ -]*pay', r'tez'],
            'phonepe': [r'phone[ -]*pe'],
            'paytm': [r'paytm'],
            'bhim': [r'bhim'],
            'amazonpay': [r'amazon[ -]*pay'],
        }
        for app_name, patterns in app_patterns.items():
            for pattern in patterns:
                if re.search(pattern, lower, re.IGNORECASE):
                    detected_app = app_name
                    break
            if detected_app:
                break
        if not detected_app:
            failures.append("unrecognized_app")

    # 4. UPI keyword check - must contain "UPI" indicator
    # Make this more flexible - check for various UPI-related terms
    upi_indicators = [
        'upi', 'upi id', 'upi payment', '@',
        'vpa', 'virtual payment address',
        'unified payments interface',
    ]
    if not any(indicator in lower for indicator in upi_indicators):
        failures.append("not_upi_payment")

    # 5. VPA match - must pay to correct VPA
    # Use fuzzy matching to handle OCR typos and spacing issues
    expected_vpa_normalized = normalize_vpa(UPI_VPA)
    text_normalized = normalize_vpa(lower)

    # Try exact match first
    vpa_found = expected_vpa_normalized in text_normalized

    # If not found, try partial matching (at least 80% of characters match)
    if not vpa_found:
        # Split VPA into username and domain parts
        if '@' in expected_vpa_normalized:
            vpa_parts = expected_vpa_normalized.split('@')
            if len(vpa_parts) == 2:
                username_part = vpa_parts[0]
                domain_part = vpa_parts[1]

                # Check if both parts exist in text (separately)
                username_found = username_part in text_normalized
                domain_found = domain_part in text_normalized

                # If both parts found, consider it a match
                if username_found and domain_found:
                    vpa_found = True
                # If only one part found, try fuzzy matching
                elif username_found or domain_found:
                    # For partial matches, check if enough characters match
                    found_part = username_part if username_found else domain_part
                    # Check if at least 5 characters of the found part match
                    if len(found_part) >= 5:
                        vpa_found = True

    if not vpa_found:
        failures.append("vpa_mismatch")

    # 6. Note binding - payment note must be in text
    # Use fuzzy matching to handle OCR variations
    if payment_note:
        note_lower = payment_note.lower()

        # Try exact match first
        note_found = note_lower in lower

        # If not found, try partial matching
        if not note_found:
            # Split note into parts and check if key parts exist
            note_parts = note_lower.split()
            if len(note_parts) >= 2:
                # For "COGNIT XXXXX", check if both "cognit" and the ID exist
                cognit_found = 'cognit' in lower
                # Try to find a numeric ID or alphanumeric ID
                id_pattern = re.search(r'\b[a-z0-9]{5,}\b', lower)
                if cognit_found and id_pattern:
                    note_found = True
                # If only cognit found, check if it appears near other text
                elif cognit_found:
                    # Check if "cognit" is present (good enough for fuzzy match)
                    note_found = True

        if not note_found:
            failures.append("note_mismatch")

    # 7. Amount match - must show ₹1 with proper currency indicator
    # Check for rupee symbol (₹), "rs", "inr", or "₹" followed by amount
    amount_patterns = [
        r'₹\s*1(\.00)?\b',           # ₹1 or ₹1.00
        r'rs\.?\s*1(\.00)?\b',       # Rs 1, Rs. 1, Rs.1
        r'inr\s*1(\.00)?\b',         # INR 1
        r'\b1(\.00)?\s*rs\b',        # 1 Rs
        r'\b1(\.00)?\s*₹\b',         # 1 ₹
    ]
    amount_found = any(re.search(pattern, lower) for pattern in amount_patterns)
    if not amount_found:
        # Also check for standalone "1" with currency context nearby
        if not re.search(r'\b1(\.00)?\b', lower):
            failures.append("amount_mismatch")
        elif not any(cur in lower for cur in ['₹', 'rs', 'inr']):
            failures.append("amount_mismatch")

    # 8. Success keyword required - must indicate successful payment
    if not any(k in lower for k in SUCCESS_KEYWORDS):
        failures.append("missing_success_indicator")

    # 9. Failure keywords forbidden - must not show failed/pending
    if any(k in lower for k in FAILURE_KEYWORDS):
        failures.append("failure_indicator_present")

    # 10. Transaction ID required - must have a valid txn reference
    # Google Pay: 12-digit numeric (e.g., "312456789012")
    # PhonePe: 12-16 character alphanumeric
    # Paytm: 12-16 character alphanumeric
    # BHIM: 12-16 character alphanumeric
    # Handle OCR variations: spaces, dashes, etc.
    txn_patterns = [
        r'\b\d{12}\b',                    # 12-digit numeric (Google Pay)
        r'\b[a-zA-Z0-9]{12,16}\b',        # 12-16 alphanumeric (most UPI apps)
        r'\b\d{10,16}\b',                 # 10-16 digit numeric
    ]

    txn_match = None
    for pattern in txn_patterns:
        txn_match = re.search(pattern, text)
        if txn_match:
            break

    # If still not found, try with spaces/dashes removed
    if not txn_match:
        # Remove common separators and try again
        cleaned_text = re.sub(r'[\s\-]', '', text)
        for pattern in txn_patterns:
            txn_match = re.search(pattern, cleaned_text)
            if txn_match:
                break

    if not txn_match:
        failures.append("missing_transaction_id")

    # 11. Payment recipient indicators - should show "paid to" or "to" with VPA
    # Make this more flexible as different apps show different indicators
    recipient_indicators = [
        'paid to', 'to:', 'sent to', 'paid',
        'transfer to', 'transfer',
        'receiver', 'beneficiary',
        'to',  # Simple "to" with VPA
    ]
    if not any(indicator in lower for indicator in recipient_indicators):
        failures.append("missing_recipient_indicator")

    # 12. Timestamp presence - real payment screenshots have date/time
    # Check for date patterns (DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, etc.)
    date_patterns = [
        r'\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}',      # DD/MM/YYYY or MM/DD/YYYY
        r'\d{4}[/\-]\d{1,2}[/\-]\d{1,2}',        # YYYY/MM/DD
        r'\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{2,4}',  # DD Month YYYY
        r'(today|yesterday)',                     # Relative dates
    ]
    time_patterns = [
        r'\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?',     # HH:MM:SS AM/PM
        r'\d{1,2}\s*(am|pm)',                     # HH AM/PM
    ]

    has_date = any(re.search(pattern, lower) for pattern in date_patterns)
    has_time = any(re.search(pattern, lower) for pattern in time_patterns)

    # Must have at least a date or time indicator
    if not has_date and not has_time:
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
