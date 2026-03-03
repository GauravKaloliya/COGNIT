"""
Middleware package for C.O.G.N.I.T. backend application.

Note: Primary middleware implementations are in the top-level middleware/ directory.
This package exists for future app-specific middleware extensions.
"""

# Re-export from top-level middleware if needed
try:
    from middleware import (
        require_payment_completed,
        require_valid_payment_session,
        require_valid_stage_transition,
        device_fingerprint_middleware,
        get_ip_hash,
        validate_payment_timer,
        check_global_duplicate_screenshot,
        detect_upi_app,
        analyze_fraud_signals
    )
except ImportError:
    pass
