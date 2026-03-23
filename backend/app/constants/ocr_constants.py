"""Shared OCR/domain constants and patterns."""

from __future__ import annotations

import re

APP_GPAY = "gpay"
APP_PAYTM = "paytm"
APP_BHIM = "bhim"
APP_UNKNOWN = "unknown"
APP_GOOGLE_PAY = "google pay"
TEXTRACT_SERVICE_NAME = "textract"
IMAGE_FORMAT_PNG = "PNG"
CONTENT_TYPE_IMAGE_JPEG = "image/jpeg"
DEFAULT_SCREENSHOT_TIMEZONE = "Asia/Kolkata"

FAILURE_UNRECOGNIZED_APP = "unrecognized_app"
FAILURE_MISSING_PAID_TO_COGNIT = "missing_paid_to_cognit"
FAILURE_MISSING_PAYTM_LABEL = "missing_paytm_label"
FAILURE_MISSING_BHIM_LABEL = "missing_bhim_label"
FAILURE_MISSING_PAID_BHIM = "missing_paid_bhim"
FAILURE_INVALID_BANKING_NAME = "invalid_banking_name"
FAILURE_INVALID_AMOUNT = "invalid_amount"
FAILURE_INVALID_DATETIME_GPAY = "invalid_datetime_format_gpay"
FAILURE_INVALID_DATETIME_PAYTM = "invalid_datetime_format_paytm"
FAILURE_INVALID_DATETIME_BHIM = "invalid_datetime_format_bhim"
FAILURE_TIME_OUT_OF_RANGE = "time_out_of_range"
FAILURE_MISSING_SUCCESS = "missing_success"
FAILURE_FAILURE_INDICATOR = "failure_indicator"

REGEX_TIME_12H = re.compile(r"\b(0?[1-9]|1[0-2]):([0-5][0-9])\s*(am|pm)\b", re.IGNORECASE)
REGEX_GPAY_DATE = re.compile(
    r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
    r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+"
    r"(\d{4})\b",
    re.IGNORECASE,
)
REGEX_PAYTM_DATE_DAY_FIRST = re.compile(
    r"\b(0?[1-9]|[12][0-9]|3[01])\s+"
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
    r"(\d{2}|\d{4})?\b",
    re.IGNORECASE,
)
REGEX_PAYTM_DATE_MONTH_FIRST = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
    r"(0?[1-9]|[12][0-9]|3[01]),?\s+"
    r"(\d{2}|\d{4})?\b",
    re.IGNORECASE,
)
REGEX_BHIM_DATE = re.compile(
    r"\b(0?[1-9]|[12][0-9]|3[01])(st|nd|rd|th)\s+"
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+"
    r"(\d{2})\b",
    re.IGNORECASE,
)
REGEX_PAYTM_LABEL = re.compile(r"\bpaytm\b", re.IGNORECASE)
REGEX_BHIM_LABEL = re.compile(r"\bbhim\b", re.IGNORECASE)
REGEX_PAID = re.compile(r"\bpaid\b", re.IGNORECASE)
REGEX_AMOUNT = re.compile(r"(?:₹\s*1(?:\.00)?\b|rs\.?\s*1(?:\.00)?\b)", re.IGNORECASE)
REGEX_GPAY_APP = re.compile(r"\bgpay\b", re.IGNORECASE)
REGEX_GOOGLE_PAY = re.compile(r"\bgoogle\s*pay\b", re.IGNORECASE)
DISALLOWED_APP_PATTERNS = [
    re.compile(r"\bphone\s*pe\b", re.IGNORECASE),
    re.compile(r"\bphonepe\b", re.IGNORECASE),
    re.compile(r"\bamazon\s*pay\b", re.IGNORECASE),
    re.compile(r"\bamazonpay\b", re.IGNORECASE),
    re.compile(r"\bbharat\s*pe\b", re.IGNORECASE),
    re.compile(r"\bbharatpe\b", re.IGNORECASE),
]
MONTH_FULL = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
MONTH_SHORT = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
