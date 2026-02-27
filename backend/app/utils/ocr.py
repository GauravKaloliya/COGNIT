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

def verify_payment_screenshot(
    image: Image.Image,
    text: str,
    expected_amount: float,
    payment_note: str,
    confidence: float
) -> Tuple[bool, Optional[str], List[str]]:
    """
    Simplified validation of UPI payment screenshot.
    Only verifies that the screenshot is from an allowed UPI app.

    Args:
        image: PIL Image object
        text: OCR extracted text
        expected_amount: Expected payment amount (not used in simplified validation)
        payment_note: Expected payment note/reference (not used in simplified validation)
        confidence: OCR confidence score (not used in simplified validation)

    Returns:
        Tuple of (is_valid, detected_app, failure_reasons)
    """
    failures = []
    lower = text.lower()

    # App detection - must be from allowed UPI app
    detected_app = detect_upi_app(text)
    if not detected_app:
        # Try fuzzy matching for app detection to handle OCR variations
        app_patterns = {
            'gpay': [r'g[ -]*pay', r'goo[gl]*[ -]*pay', r'tez'],
            'phonepe': [r'phone[ -]*pe'],
            'paytm': [r'paytm'],
            'bhim': [r'bhim'],
            'amazonpay': [r'amazon[ -]*pay']
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
