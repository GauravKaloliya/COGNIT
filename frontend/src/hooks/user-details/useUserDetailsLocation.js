import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runtimeConfig } from "../../config/runtime";
import { uiText } from "../../utils/uiText";
import { readExpiringValue, writeExpiringValue } from "../../utils/storage";
import { GEOLOCATION_ERROR_CODES, REVERSE_GEOCODE_FIELDS, USER_DETAIL_FIELDS } from "../../constants/userDetails";
import { sanitizeLocationValue } from "../../utils/userDetailsHelpers";

const LOCATION_MIN_LENGTH = runtimeConfig.locationMinLength;
const REVERSE_GEOCODE_STATE_KEY = runtimeConfig.storageKeys.reverseGeocodeState;
const REVERSE_GEOCODE_MIN_INTERVAL_MS = 10000;
const REVERSE_GEOCODE_MAX_BACKOFF_MS = 60000;
const REVERSE_GEOCODE_TTL_MS = runtimeConfig.reverseGeocodeTtlMs;
const REVERSE_GEOCODE_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const DESKTOP_LOCATION_SESSION_KEY = runtimeConfig.storageKeys.desktopLocationSession;
const DESKTOP_LOCATION_SCHEMA_VERSION = runtimeConfig.uiStateSchemaVersion;
const DESKTOP_LOCATION_TTL_MS = runtimeConfig.uiStateTtlMs;

function readDesktopLocationSession() {
  const parsed = readExpiringValue(DESKTOP_LOCATION_SESSION_KEY, null, {
    area: "session",
    schemaVersion: DESKTOP_LOCATION_SCHEMA_VERSION,
    ttlMs: DESKTOP_LOCATION_TTL_MS,
  });
  if (!parsed || typeof parsed !== "object") return { prompted: false, permission: "unknown", value: "" };
  return {
    prompted: parsed?.prompted === true,
    permission: typeof parsed?.permission === "string" ? parsed.permission : "unknown",
    value: typeof parsed?.value === "string" ? parsed.value : "",
  };
}

function writeDesktopLocationSession(patch) {
  const current = readDesktopLocationSession();
  writeExpiringValue(DESKTOP_LOCATION_SESSION_KEY, {
    ...current,
    ...patch,
  }, {
    area: "session",
    schemaVersion: DESKTOP_LOCATION_SCHEMA_VERSION,
    ttlMs: DESKTOP_LOCATION_TTL_MS,
  });
}

export function useUserDetailsLocation({
  isMobile,
  demographicsLocation,
  setDemographics,
  setErrors,
}) {
  const initialDesktopLocationSession = useMemo(
    () => (isMobile ? { prompted: false, permission: "unknown", value: "" } : readDesktopLocationSession()),
    [isMobile]
  );
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [locationPermissionState, setLocationPermissionState] = useState(initialDesktopLocationSession.permission);
  const [manualLocationAllowed, setManualLocationAllowed] = useState(true);
  const [locationAutoSucceeded, setLocationAutoSucceeded] = useState(
    !isMobile && Boolean(sanitizeLocationValue(initialDesktopLocationSession.value))
  );
  const locationAttemptedRef = useRef(false);
  const autoDetectStartedRef = useRef(false);
  const reverseGeocodeAbortRef = useRef(null);
  const userEditedLocationRef = useRef(false);

  const setDetectedLocation = useCallback((value) => {
    if (userEditedLocationRef.current) return;
    const sanitized = sanitizeLocationValue(value);
    setDemographics((prev) => ({ ...prev, location: sanitized }));
    setLocationPermissionDenied(false);
    setManualLocationAllowed(true);
    setErrors((prev) => {
      if (!prev.location) return prev;
      const next = { ...prev };
      delete next.location;
      return next;
    });
  }, [setDemographics, setErrors]);

  const markLocationAutoSuccess = useCallback(() => {
    setLocationAutoSucceeded(true);
    setLocationPermissionDenied(false);
    setLocationPermissionState("granted");
    setManualLocationAllowed(true);
    setLocationStatus("");
  }, []);

  const getBrowserPosition = useCallback((options) => (
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    })
  ), []);

  const detectLocation = useCallback(() => {
    if (isMobile) {
      setManualLocationAllowed(true);
      setLocationPermissionDenied(false);
      setLocationPermissionState("unknown");
      setLocationStatus("");
      return;
    }
    locationAttemptedRef.current = true;
    setLocationPermissionDenied(false);
    writeDesktopLocationSession({ prompted: true });
    setErrors((prev) => {
      if (!prev.location) return prev;
      const next = { ...prev };
      delete next.location;
      return next;
    });
    if (!navigator.geolocation) {
      setLocationStatus(uiText("user.locationFallback"));
      setLocationPermissionDenied(false);
      setManualLocationAllowed(true);
      writeDesktopLocationSession({ prompted: true, permission: "unknown" });
      return;
    }

    const resolveLocation = async () => {
      try {
        if (navigator.permissions?.query) {
          try {
            const permission = await navigator.permissions.query({ name: "geolocation" });
            const permissionState = permission?.state || "unknown";
            setLocationPermissionState(permissionState);
            if (permissionState === "denied") {
              setLocationPermissionDenied(true);
              writeDesktopLocationSession({ prompted: true, permission: "denied", value: "" });
              setLocationStatus(uiText("user.locationPermissionDenied"));
              return;
            }
          } catch {
            // Ignore permission API failures.
          }
        }

        setLocating(true);
        setLocationStatus(uiText("user.locationRequesting"));
        let position;
        try {
          position = await getBrowserPosition({
            enableHighAccuracy: false,
            timeout: runtimeConfig.geolocationTimeoutMs,
            maximumAge: runtimeConfig.geolocationMaxAgeMs,
          });
        } catch {
          setLocationStatus(uiText("user.locationRetrying"));
          position = await getBrowserPosition({
            enableHighAccuracy: true,
            timeout: Math.max(runtimeConfig.geolocationTimeoutMs * 2, 20000),
            maximumAge: 0,
          });
        }
        setLocationPermissionState("granted");
        const { latitude, longitude } = position.coords;
        let detectedLocation = "";

        try {
          const now = Date.now();
          const storedReverseState = readExpiringValue(REVERSE_GEOCODE_STATE_KEY, null, {
            area: "session",
            schemaVersion: REVERSE_GEOCODE_SCHEMA_VERSION,
            ttlMs: REVERSE_GEOCODE_TTL_MS,
          });
          const reverseState = {
            [REVERSE_GEOCODE_FIELDS.nextAllowedAt]: Number(storedReverseState?.[REVERSE_GEOCODE_FIELDS.nextAllowedAt] || 0),
            [REVERSE_GEOCODE_FIELDS.failCount]: Number(storedReverseState?.[REVERSE_GEOCODE_FIELDS.failCount] || 0),
          };
          if (now < reverseState[REVERSE_GEOCODE_FIELDS.nextAllowedAt]) {
            setManualLocationAllowed(true);
            if (locationAttemptedRef.current) setLocationStatus(uiText("user.locationFallback"));
            return;
          }
          if (reverseGeocodeAbortRef.current) reverseGeocodeAbortRef.current.abort();
          const controller = new AbortController();
          reverseGeocodeAbortRef.current = controller;
          const reverse = await fetch(
            `${runtimeConfig.reverseGeocodeUrl}?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`,
            { signal: controller.signal }
          );
          if (reverse.ok) {
            const data = await reverse.json();
            const address = data?.address || {};
            const city = address.city || address.town || address.village || address.hamlet;
            const state = address.state;
            const country = address.country;
            const composed = [city, state, country].filter(Boolean).join(", ");
            if (composed.length >= LOCATION_MIN_LENGTH) detectedLocation = composed;
            writeExpiringValue(REVERSE_GEOCODE_STATE_KEY, {
              [REVERSE_GEOCODE_FIELDS.nextAllowedAt]: now + REVERSE_GEOCODE_MIN_INTERVAL_MS,
              [REVERSE_GEOCODE_FIELDS.failCount]: 0,
            }, {
              area: "session",
              schemaVersion: REVERSE_GEOCODE_SCHEMA_VERSION,
              ttlMs: REVERSE_GEOCODE_TTL_MS,
            });
          }
        } catch {
          const now = Date.now();
          const storedReverseState = readExpiringValue(REVERSE_GEOCODE_STATE_KEY, null, {
            area: "session",
            schemaVersion: REVERSE_GEOCODE_SCHEMA_VERSION,
            ttlMs: REVERSE_GEOCODE_TTL_MS,
          });
          const failCount = Number(storedReverseState?.[REVERSE_GEOCODE_FIELDS.failCount] || 0);
          const nextFailCount = Math.min(5, failCount + 1);
          const backoffMs = Math.min(REVERSE_GEOCODE_MAX_BACKOFF_MS, REVERSE_GEOCODE_MIN_INTERVAL_MS * (2 ** nextFailCount));
          writeExpiringValue(REVERSE_GEOCODE_STATE_KEY, {
            [REVERSE_GEOCODE_FIELDS.nextAllowedAt]: now + backoffMs,
            [REVERSE_GEOCODE_FIELDS.failCount]: nextFailCount,
          }, {
            area: "session",
            schemaVersion: REVERSE_GEOCODE_SCHEMA_VERSION,
            ttlMs: REVERSE_GEOCODE_TTL_MS,
          });
        } finally {
          reverseGeocodeAbortRef.current = null;
        }

        userEditedLocationRef.current = false;
        setDetectedLocation(detectedLocation);
        if (sanitizeLocationValue(detectedLocation)) {
          writeDesktopLocationSession({ prompted: true, permission: "granted", value: sanitizeLocationValue(detectedLocation) });
          markLocationAutoSuccess();
          setLocationStatus(uiText("user.locationDetected"));
        } else {
          writeDesktopLocationSession({ prompted: true, permission: "granted", value: "" });
          setManualLocationAllowed(true);
          if (locationAttemptedRef.current) setLocationStatus(uiText("user.locationFallback"));
        }
      } catch (error) {
        const denied = error?.code === GEOLOCATION_ERROR_CODES.permissionDenied;
        setLocationPermissionState(denied ? "denied" : "unknown");
        setLocationPermissionDenied(denied);
        writeDesktopLocationSession({ prompted: true, permission: denied ? "denied" : "unknown", value: "" });
        setManualLocationAllowed(true);
        setLocationStatus(denied ? uiText("user.locationPermissionDenied") : uiText("user.locationFallback"));
        setErrors((prev) => {
          const next = { ...prev };
          delete next[USER_DETAIL_FIELDS.location];
          return next;
        });
      } finally {
        setLocating(false);
      }
    };
    void resolveLocation();
  }, [getBrowserPosition, isMobile, markLocationAutoSuccess, setDetectedLocation, setErrors]);

  useEffect(() => {
    if (isMobile) {
      setLocating(false);
      setLocationPermissionDenied(false);
      setLocationPermissionState("unknown");
      setManualLocationAllowed(true);
      setLocationAutoSucceeded(false);
      setLocationStatus("");
      return;
    }

    const saved = readDesktopLocationSession();
    setLocationPermissionState(saved.permission);
    setLocationPermissionDenied(saved.permission === "denied");
    setLocationAutoSucceeded(Boolean(sanitizeLocationValue(saved.value)));
    setManualLocationAllowed(true);
    if (sanitizeLocationValue(saved.value) && !sanitizeLocationValue(demographicsLocation)) {
      userEditedLocationRef.current = false;
      setDetectedLocation(saved.value);
    }
    if (autoDetectStartedRef.current) return;
    autoDetectStartedRef.current = true;
    const session = readDesktopLocationSession();
    if (session.permission === "granted" || session.permission === "denied" || session.prompted) return;
    detectLocation();
  }, [demographicsLocation, detectLocation, isMobile, setDetectedLocation]);

  useEffect(() => {
    if (!locationAutoSucceeded) return;
    setLocationPermissionDenied(false);
    setManualLocationAllowed(true);
    setLocationStatus("");
  }, [locationAutoSucceeded]);

  useEffect(() => {
    if (isMobile) return;
    if (locationPermissionState !== "granted" || locating) return;
    setLocationPermissionDenied(false);
    setManualLocationAllowed(true);
  }, [isMobile, locationPermissionState, locating]);

  useEffect(() => {
    const sanitized = sanitizeLocationValue(demographicsLocation);
    if (sanitized !== String(demographicsLocation || "")) {
      setDemographics((prev) => ({ ...prev, location: sanitized }));
      if (!isMobile && locationPermissionState === "granted") {
        writeDesktopLocationSession({ prompted: true, permission: "granted", value: sanitized });
      }
      if (!sanitized) setManualLocationAllowed(true);
    }
  }, [demographicsLocation, isMobile, locationPermissionState, setDemographics]);

  useEffect(() => () => {
    if (reverseGeocodeAbortRef.current) {
      reverseGeocodeAbortRef.current.abort();
      reverseGeocodeAbortRef.current = null;
    }
  }, []);

  return {
    locating,
    locationStatus,
    locationPermissionDenied,
    locationPermissionState,
    manualLocationAllowed,
    locationAutoSucceeded,
    userEditedLocationRef,
    detectLocation,
  };
}
