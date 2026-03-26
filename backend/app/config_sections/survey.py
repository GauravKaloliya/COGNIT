"""Survey and attention-scoring config section."""

from __future__ import annotations

from .env import float_env, int_env

MIN_WORD_COUNT = int_env("MIN_WORD_COUNT", 60, min_value=1)
MIN_DESCRIPTION_LENGTH = int_env("MIN_DESCRIPTION_LENGTH", 60, min_value=1)
MAX_DESCRIPTION_LENGTH = int_env("MAX_DESCRIPTION_LENGTH", 10000, min_value=1)
MIN_FEEDBACK_LENGTH = int_env("MIN_FEEDBACK_LENGTH", 5, min_value=1)
MAX_FEEDBACK_LENGTH = int_env("MAX_FEEDBACK_LENGTH", 2000, min_value=1)
MIN_RATING = int_env("MIN_RATING", 1, min_value=1)
MAX_RATING = int_env("MAX_RATING", 5, min_value=1)
TOO_FAST_SECONDS = float_env("TOO_FAST_SECONDS", 5.0, min_value=0.0)
STAGE_STALE_TIMEOUT_SECONDS = int_env("STAGE_STALE_TIMEOUT_SECONDS", 2 * 60 * 60, min_value=60, max_value=7 * 24 * 60 * 60)

ATTENTION_FLAG_THRESHOLD = 0.5
ATTENTION_FLAG_MIN_CHECKS = 5
ATTENTION_HARD_FLAG_CONSEC_FAILS = 2
ATTENTION_MIN_DISTINCT_WORDS = 5
ATTENTION_MIN_CHAR_LENGTH = 60
ATTENTION_MIN_RECALL = float_env("ATTENTION_MIN_RECALL", 0.5, min_value=0.0, max_value=1.0)
ATTENTION_INTERVAL = 3

IMAGE_PICK_ATTEMPTS_ATTENTION = int_env("IMAGE_PICK_ATTEMPTS_ATTENTION", 4, min_value=1, max_value=50)
IMAGE_PICK_ATTEMPTS_NON_ATTENTION = int_env("IMAGE_PICK_ATTEMPTS_NON_ATTENTION", 4, min_value=1, max_value=50)
