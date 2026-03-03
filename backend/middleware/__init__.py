"""
Middleware Package
Security and validation middleware for the payment system
"""

from .device_fingerprint import (
    generate_canvas_fingerprint,
    collect_device_characteristics,
    generate_device_fingerprint,
    calculate_risk_score,
    get_or_create_device_fingerprint,
    device_fingerprint_middleware
)

from .payment_flow import (
    require_payment_completed,
    require_valid_payment_session,
    require_valid_stage_transition,
    log_payment_flow_event
)

from .flow_validator import (
    get_ip_hash,
    validate_required_fields,
    validate_payment_timer,
    check_global_duplicate_screenshot,
    detect_upi_app,
    validate_screenshot_metadata,
    analyze_fraud_signals,
    rate_limit_by_participant
)

__all__ = [
    # Device fingerprinting
    'generate_canvas_fingerprint',
    'collect_device_characteristics',
    'generate_device_fingerprint',
    'calculate_risk_score',
    'get_or_create_device_fingerprint',
    'device_fingerprint_middleware',
    
    # Payment flow
    'require_payment_completed',
    'require_valid_payment_session',
    'require_valid_stage_transition',
    'log_payment_flow_event',
    
    # Flow validation
    'get_ip_hash',
    'validate_required_fields',
    'validate_payment_timer',
    'check_global_duplicate_screenshot',
    'detect_upi_app',
    'validate_screenshot_metadata',
    'analyze_fraud_signals',
    'rate_limit_by_participant'
]
