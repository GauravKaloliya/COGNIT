"""Shared submission text-processing regex constants."""

import re

ATTN_TOKEN_SPLIT_RE = re.compile(r"[|,;/]+")
NORMALIZE_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
NORMALIZE_WHITESPACE_RE = re.compile(r"\s+")
ALPHABETIC_TOKEN_RE = re.compile(r"\b[a-z]{2,}\b")
STRICT_TERM_TEMPLATE = r"\\b{term}\\b"
