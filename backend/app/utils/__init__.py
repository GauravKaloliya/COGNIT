"""
Utilities package for C.O.G.N.I.T. backend.
Provides common utilities for security, OCR, fraud detection, and helpers.
"""

from app.utils.decorators import (
    track_performance,
)

from app.utils.helpers import (
    get_ip_hash,
    count_words,
    calculate_quality_score,
    log_audit,
    error_response,
    success_response,
    create_error_response,
    get_file_extension,
    validate_image_extension,
)

from app.utils.security import (
    generate_payment_signature,
    generate_upi_link,
)

from app.utils.ocr import (
    fetch_s3_image,
    extract_text_with_confidence,
    detect_upi_app,
    verify_payment_screenshot,
)

from app.utils.fraud import (
    check_duplicate_screenshot,
    check_rejected_screenshot,
)


__all__ = [
    # Decorators
    'track_performance',
    
    # Helpers
    'get_ip_hash',
    'count_words',
    'calculate_quality_score',
    'log_audit',
    'error_response',
    'success_response',
    'create_error_response',
    'get_file_extension',
    'validate_image_extension',
    
    # Security
    'generate_payment_signature',
    'generate_upi_link',
    
    # OCR
    'fetch_s3_image',
    'extract_text_with_confidence',
    'detect_upi_app',
    'verify_payment_screenshot',
    
    # Fraud
    'check_duplicate_screenshot',
    'check_rejected_screenshot',
]
