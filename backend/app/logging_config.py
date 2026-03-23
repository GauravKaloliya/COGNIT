"""
Vercel-compatible logging configuration.
Configures logging handlers that write to stdout for Vercel's runtime log collection.
"""

import logging
import sys

from app.config import LOG_LEVEL, LOGGING_AUTO_CONFIG, SUPPRESS_ACCESS_LOGS


_logging_already_configured = False


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
    global _logging_already_configured

    if _logging_already_configured:
        return logging.getLogger()

    if log_level is None:
        log_level = LOG_LEVEL

    level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(level)

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    stdout_handler.setFormatter(formatter)

    root_logger.handlers.clear()
    root_logger.addHandler(stdout_handler)

    loggers = [
        "app",
        "app.routes",
        "app.utils",
        "middleware",
        "main",
    ]

    for logger_name in loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(level)
        logger.propagate = True

    werkzeug_logger = logging.getLogger("werkzeug")
    werkzeug_logger.setLevel(logging.WARNING)
    if SUPPRESS_ACCESS_LOGS:
        werkzeug_logger.disabled = True
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)

    _logging_already_configured = True

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


if LOGGING_AUTO_CONFIG:
    configure_logging()
