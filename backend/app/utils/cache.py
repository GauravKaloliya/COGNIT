"""Lightweight cache facade with Redis fallback and in-memory backup."""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

from app.config import APP_CACHE_TTL_SECONDS, APP_CACHE_URL

logger = logging.getLogger(__name__)


@dataclass
class _MemoryEntry:
    value: str
    expires_at: float


class _MemoryCache:
    def __init__(self):
        self._store: dict[str, _MemoryEntry] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            if now >= entry.expires_at:
                self._store.pop(key, None)
                return None
            return entry.value

    def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        expires_at = time.time() + max(1, int(ttl_seconds))
        with self._lock:
            self._store[key] = _MemoryEntry(value=value, expires_at=expires_at)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


class _CacheFacade:
    def __init__(self):
        self._memory = _MemoryCache()
        self._redis = None
        self._init_redis()

    def _init_redis(self) -> None:
        cache_url = (APP_CACHE_URL or "").strip()
        if not cache_url:
            return
        try:
            import redis  # type: ignore[import-untyped]

            client = redis.from_url(cache_url, socket_timeout=0.2, socket_connect_timeout=0.2)
            client.ping()
            self._redis = client
        except Exception as exc:
            logger.warning("cache_redis_unavailable: %s", exc)
            self._redis = None

    def get_json(self, key: str) -> Any | None:
        raw = None
        if self._redis is not None:
            try:
                value = self._redis.get(key)
                raw = value.decode("utf-8") if isinstance(value, (bytes, bytearray)) else value
            except Exception:
                raw = None
        if raw is None:
            raw = self._memory.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        ttl = max(1, int(ttl_seconds or APP_CACHE_TTL_SECONDS))
        raw = json.dumps(value, separators=(",", ":"), ensure_ascii=True)
        if self._redis is not None:
            try:
                self._redis.setex(key, ttl, raw)
            except Exception:
                pass
        self._memory.setex(key, ttl, raw)

    def delete(self, key: str) -> None:
        if self._redis is not None:
            try:
                self._redis.delete(key)
            except Exception:
                pass
        self._memory.delete(key)


cache = _CacheFacade()

