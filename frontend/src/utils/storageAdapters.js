import { runtimeConfig } from "../config/runtime";
import { createStorageAdapter } from "./storage";

export const storageAdapters = {
  telemetry: createStorageAdapter(runtimeConfig.storageKeys.telemetry, {
    area: "session",
    ttlMs: runtimeConfig.uiStateTtlMs,
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
  }),
  clientErrorQueue: createStorageAdapter(runtimeConfig.storageKeys.clientErrorQueue, {
    area: "session",
    ttlMs: runtimeConfig.uiStateTtlMs,
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
  }),
  telemetryBlocked: createStorageAdapter(runtimeConfig.storageKeys.telemetryBlocked, {
    area: "session",
    ttlMs: runtimeConfig.uiStateTtlMs,
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
  }),
  emailOtpState: createStorageAdapter(runtimeConfig.storageKeys.emailOtpState, {
    area: "local",
    ttlMs: Math.max(30000, (runtimeConfig.emailOtpExpirySeconds || 300) * 1000),
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
  }),
  participantOptions: createStorageAdapter(runtimeConfig.storageKeys.participantOptions, {
    area: "session",
    ttlMs: runtimeConfig.uiStateTtlMs,
    schemaVersion: runtimeConfig.uiStateSchemaVersion,
  }),
};

export default storageAdapters;
