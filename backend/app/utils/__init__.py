"""Utilities package for C.O.G.N.I.T. backend."""

from app.utils.decorators import (
    track_performance,
)

from app.utils.helpers import (
    get_ip_hash,
    count_words,
    calculate_quality_score,
    calculate_writing_quality_score,
    calculate_behavior_risk_score,
    log_audit,
    error_response,
    success_response,
    create_error_response,
)


__all__ = [
    # Decorators
    'track_performance',
    
    # Helpers
    'get_ip_hash',
    'count_words',
    'calculate_quality_score',
    'calculate_writing_quality_score',
    'calculate_behavior_risk_score',
    'log_audit',
    'error_response',
    'success_response',
    'create_error_response',
    
]
