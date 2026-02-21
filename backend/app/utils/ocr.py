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


try:
    pytesseract.get_tesseract_version()
except Exception as exc:
    raise RuntimeError("Tesseract OCR is required for payment verification") from exc

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
    
    # 3. App detection
    detected_app = detect_upi_app(text)
    if not detected_app:
        failures.append("unrecognized_app")
    
    # 4. VPA match
    if normalize_vpa(UPI_VPA) not in normalize_vpa(lower):
        failures.append("vpa_mismatch")
    
    # 5. Note binding - payment note must be in text
    if payment_note and payment_note.lower() not in lower:
        failures.append("note_mismatch")
    
    # 6. Amount match (₹1 with variations)
    if not re.search(r"\b1(\.00)?\b", lower):
        failures.append("amount_mismatch")
    
    # 7. Success keyword required
    if not any(k in lower for k in SUCCESS_KEYWORDS):
        failures.append("missing_success_indicator")
    
    # 8. Failure keywords forbidden
    if any(k in lower for k in FAILURE_KEYWORDS):
        failures.append("failure_indicator_present")
    
    # 9. Transaction ID required
    txn_match = re.search(r"\b[a-zA-Z0-9]{12,30}\b", text)
    if not txn_match:
        failures.append("missing_transaction_id")
    
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