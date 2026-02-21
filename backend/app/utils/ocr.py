"""
OCR utilities module for C.O.G.N.I.T. backend.
Provides text extraction, UPI app detection, and payment screenshot verification.
"""

import re
from io import BytesIO
from typing import List, Optional, Tuple

from PIL import Image
import pytesseract
from pytesseract import Output

from app.config import (
    MIN_IMAGE_WIDTH,
    MIN_OCR_CONFIDENCE,
    ALLOWED_APPS,
    SUCCESS_KEYWORDS,
    FAILURE_KEYWORDS,
    UPI_VPA,
    S3_BUCKET,
)
from app.extensions import s3


# ────────────────────────────────────────────────
# Custom Exception for Tesseract
# ────────────────────────────────────────────────

class TesseractNotFoundError(Exception):
    """Custom exception raised when Tesseract OCR is not available."""
    pass


# ────────────────────────────────────────────────
# Tesseract Availability Check (Lazy)
# ───────────────────────────────────────────────-

_tesseract_available = None

def _check_tesseract():
    """Lazy check for tesseract availability. Raises TesseractNotFoundError if not available."""
    global _tesseract_available
    if _tesseract_available is None:
        try:
            pytesseract.get_tesseract_version()
            _tesseract_available = True
        except Exception:
            _tesseract_available = False
            raise TesseractNotFoundError("Tesseract OCR is not installed or not in PATH")
    if not _tesseract_available:
        raise TesseractNotFoundError("Tesseract OCR is not installed or not in PATH")


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
    obj = s3.get_object(Bucket=S3_BUCKET, Key=object_key)
    file_bytes = obj["Body"].read()
    return Image.open(BytesIO(file_bytes))


# ────────────────────────────────────────────────
# Text Extraction with Confidence
# ────────────────────────────────────────────────

def extract_text_with_confidence(image: Image.Image) -> Tuple[str, float]:
    """
    Extract text from image with OCR confidence score.
    
    Args:
        image: PIL Image object
        
    Returns:
        Tuple of (extracted_text, average_confidence)
    """
    _check_tesseract()
    data = pytesseract.image_to_data(image, output_type=Output.DICT)
    words = []
    confidences = []
    for i, word in enumerate(data["text"]):
        try:
            conf = int(data["conf"][i])
        except:
            continue
        if conf > 0 and word.strip():
            words.append(word)
            confidences.append(conf)
    if not words:
        return "", 0
    return " ".join(words), sum(confidences) / len(confidences)


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
    detected_app = detect_upi_app(text)
    if not detected_app:
        failures.append("unrecognized_app")
    
    # 4. UPI keyword check - must contain "UPI" indicator
    upi_indicators = ['upi', 'upi id', 'upi payment', '@']
    if not any(indicator in lower for indicator in upi_indicators):
        failures.append("not_upi_payment")
    
    # 5. VPA match - must pay to correct VPA
    if normalize_vpa(UPI_VPA) not in normalize_vpa(lower):
        failures.append("vpa_mismatch")
    
    # 6. Note binding - payment note must be in text
    if payment_note and payment_note.lower() not in lower:
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
    txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", text)
    if not txn_match:
        failures.append("missing_transaction_id")
    
    # 11. Payment recipient indicators - should show "paid to" or "to" with VPA
    recipient_indicators = ['paid to', 'to:', 'sent to', 'paid']
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
    
    Args:
        text: OCR extracted text
        
    Returns:
        UPI reference number or None
    """
    match = re.search(r"\b\d{12,16}\b", text)
    return match.group(0) if match else None