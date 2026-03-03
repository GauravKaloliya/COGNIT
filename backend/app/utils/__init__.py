"""
Utilities package for C.O.G.N.I.T. backend.
Provides common utilities for security, OCR, fraud detection, and helpers.
"""

from app.utils.decorators import (
    log_errors,
    track_performance,
    handle_db_error,
)

from app.utils.helpers import (
    get_ip_hash,
    count_words,
    detect_bot_like_content,
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
    normalize_vpa,
    verify_payment_screenshot,
    extract_upi_ref,
)

from app.utils.fraud import (
    check_duplicate_screenshot,
    check_rejected_screenshot,
    compute_fraud_score,
)


__all__ = [
    # Decorators
    'log_errors',
    'track_performance',
    'handle_db_error',
    
    # Helpers
    'get_ip_hash',
    'count_words',
    'detect_bot_like_content',
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
    'normalize_vpa',
    'verify_payment_screenshot',
    'extract_upi_ref',
    
    # Fraud
    'check_duplicate_screenshot',
    'check_rejected_screenshot',
    'compute_fraud_score',
]