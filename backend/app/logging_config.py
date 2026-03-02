"""
Vercel-compatible logging configuration.
Configures logging handlers that write to stdout for Vercel's runtime log collection.
"""

import logging
import sys
import os


_logging_configured = False


def configure_logging(log_level=None):
    """
    Configure logging to stdout for Vercel runtime log collection.
    
    Vercel captures stdout/stderr from serverless functions, so we configure
    a StreamHandler that writes to stdout with proper formatting.
    
    Args:
        log_level: Optional log level string (DEBUG, INFO, WARNING, ERROR, CRITICAL).
                   Defaults to LOG_LEVEL env var or INFO.
    
    Returns:
        logging.Logger: The configured root logger.
    """
    global _logging_configured

    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO")

    # Convert string to logging level
    level = getattr(logging, log_level.upper(), logging.INFO)

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Configure specific loggers for our app components
    loggers = [
        "app",
        "app.routes",
        "app.utils",
        "app.middleware",
        "main",
    ]

    if _logging_configured:
        for handler in root_logger.handlers:
            handler.setLevel(level)

        for logger_name in loggers:
            logger = logging.getLogger(logger_name)
            logger.setLevel(level)
            logger.propagate = True

        # Reduce noise from third-party libraries
        logging.getLogger("werkzeug").setLevel(logging.WARNING)
        logging.getLogger("urllib3").setLevel(logging.WARNING)
        logging.getLogger("botocore").setLevel(logging.WARNING)
        logging.getLogger("boto3").setLevel(logging.WARNING)

        return root_logger

    # Remove any existing handlers to avoid duplicates
    # (important in serverless where the module may be re-used)
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create stdout handler - Vercel captures stdout
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(level)

    # Create formatter with timestamp, module name, level, and message
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    stdout_handler.setFormatter(formatter)

    # Add handler to root logger
    root_logger.addHandler(stdout_handler)

    for logger_name in loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        # Don't propagate to root to avoid double logging
        logger.propagate = True

    # Reduce noise from third-party libraries
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)

    _logging_configured = True

    return root_logger


def get_logger(name):
    """
    Get a logger instance for a specific module.
    
    Args:
        name: The name for the logger (typically __name__).
    
    Returns:
        logging.Logger: A configured logger instance.
    """
    return logging.getLogger(name)


# Auto-configure on import if LOGGING_AUTO_CONFIG is set
if os.getenv("LOGGING_AUTO_CONFIG", "true").lower() == "true":
    configure_logging()
