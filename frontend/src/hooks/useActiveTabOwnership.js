import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "../config/runtime";
import { ACTIVE_TAB_LOCK_FIELDS } from "../constants/fields";
import { BROWSER_EVENTS } from "../constants/browser";
import { STORAGE_EVENTS } from "../constants/patterns";
import { readExpiringValue, removeStoredKey, writeExpiringValue } from "../utils/storage";
import { clearScheduledInterval, scheduleInterval } from "../utils/timing";
import { createClientId } from "../utils/appControllerState";

const ACTIVE_TAB_LOCK_KEY = runtimeConfig.storageKeys.activeTabLock;
const ACTIVE_TAB_LOCK_SCHEMA_VERSION = runtimeConfig.activeTabLockSchemaVersion;
const ACTIVE_TAB_HEARTBEAT_MS = runtimeConfig.activeTabHeartbeatMs;
const ACTIVE_TAB_STALE_MS = runtimeConfig.activeTabStaleMs;
const ACTIVE_TAB_LOCK_TTL_MS = Math.max(60000, ACTIVE_TAB_STALE_MS * 4);

export function useActiveTabOwnership() {
  const tabIdRef = useRef(createClientId());
  const [isActiveTabOwner, setIsActiveTabOwner] = useState(true);

  const claimActiveTabLock = useCallback(() => {
    const now = Date.now();
    const tabId = tabIdRef.current;
    try {
      const parsed = readExpiringValue(ACTIVE_TAB_LOCK_KEY, null, {
        area: "local",
        schemaVersion: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
        ttlMs: ACTIVE_TAB_LOCK_TTL_MS,
      });
      if (!parsed) {
        writeExpiringValue(ACTIVE_TAB_LOCK_KEY, {
          [ACTIVE_TAB_LOCK_FIELDS.tabId]: tabId,
          [ACTIVE_TAB_LOCK_FIELDS.updatedAt]: now,
        }, {
          area: "local",
          schemaVersion: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
          ttlMs: ACTIVE_TAB_LOCK_TTL_MS,
        });
        setIsActiveTabOwner(true);
        return true;
      }

      const currentOwner = parsed?.[ACTIVE_TAB_LOCK_FIELDS.tabId];
      const updatedAt = Number(parsed?.[ACTIVE_TAB_LOCK_FIELDS.updatedAt] || 0);
      const stale = !updatedAt || now - updatedAt > ACTIVE_TAB_STALE_MS;

      if (currentOwner === tabId || stale) {
        writeExpiringValue(ACTIVE_TAB_LOCK_KEY, {
          [ACTIVE_TAB_LOCK_FIELDS.tabId]: tabId,
          [ACTIVE_TAB_LOCK_FIELDS.updatedAt]: now,
        }, {
          area: "local",
          schemaVersion: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
          ttlMs: ACTIVE_TAB_LOCK_TTL_MS,
        });
        setIsActiveTabOwner(true);
        return true;
      }

      setIsActiveTabOwner(false);
      return false;
    } catch {
      setIsActiveTabOwner(true);
      return true;
    }
  }, []);

  useEffect(() => {
    claimActiveTabLock();
    const heartbeat = scheduleInterval(claimActiveTabLock, ACTIVE_TAB_HEARTBEAT_MS);
    const onStorage = (event) => {
      if (event.key === ACTIVE_TAB_LOCK_KEY) {
        claimActiveTabLock();
      }
    };
    const releaseLockIfOwner = () => {
      try {
        const parsed = readExpiringValue(ACTIVE_TAB_LOCK_KEY, null, {
          area: "local",
          schemaVersion: ACTIVE_TAB_LOCK_SCHEMA_VERSION,
          ttlMs: ACTIVE_TAB_LOCK_TTL_MS,
        });
        if (parsed?.[ACTIVE_TAB_LOCK_FIELDS.tabId] === tabIdRef.current) {
          removeStoredKey(ACTIVE_TAB_LOCK_KEY, "local");
        }
      } catch {
        // Ignore lock release failures.
      }
    };
    window.addEventListener(STORAGE_EVENTS.storage, onStorage);
    window.addEventListener(BROWSER_EVENTS.beforeUnload, releaseLockIfOwner);
    return () => {
      clearScheduledInterval(heartbeat);
      window.removeEventListener(STORAGE_EVENTS.storage, onStorage);
      window.removeEventListener(BROWSER_EVENTS.beforeUnload, releaseLockIfOwner);
      releaseLockIfOwner();
    };
  }, [claimActiveTabLock]);

  return {
    isActiveTabOwner,
    claimActiveTabLock,
  };
}
