"use strict";

/** Native transport states. transport_active is never assigned unless the adapter reports it. */
const TRANSPORT_STATUSES = Object.freeze([
  "transport_unavailable",
  "transport_stopped",
  "transport_starting",
  "transport_ready",
  "transport_connecting",
  "transport_active",
  "transport_stopping",
  "transport_failed",
]);

const TRANSPORT_STATUS_SET = new Set(TRANSPORT_STATUSES);

/** Renderer-safe UI phases. No transport vendor names. */
const UI_PHASES = Object.freeze([
  "requested",
  "connecting",
  "active",
  "ending",
  "ended",
  "unavailable",
]);

const PUBLIC_RESULT_KEYS = Object.freeze([
  "ok",
  "status",
  "error",
  "transportInstalled",
  "transportEnabled",
  "transportStatus",
  "uiPhase",
  "credentialRotationUnsupported",
  "credentialLifecycleUnsupported",
]);

function isTransportStatus(value) {
  return TRANSPORT_STATUS_SET.has(String(value ?? ""));
}

function normalizeTransportStatus(value, fallback = "transport_unavailable") {
  const status = String(value ?? "");
  return isTransportStatus(status) ? status : fallback;
}

function uiPhaseFromNative(nativeStatus, transportStatus) {
  const transport = normalizeTransportStatus(transportStatus);
  if (transport === "transport_active") return "active";
  if (transport === "transport_stopping") return "ending";
  if (
    transport === "transport_starting" ||
    transport === "transport_ready" ||
    transport === "transport_connecting"
  ) {
    return "connecting";
  }

  const native = String(nativeStatus ?? "");
  if (native === "authorization_pending") return "requested";
  if (native === "stopped" || native === "revoked" || native === "expired") return "ended";
  if (native === "authorized_stub") {
    if (transport === "transport_unavailable" || transport === "transport_failed") return "unavailable";
    return "connecting";
  }
  if (native === "not_authorized" && transport === "transport_stopped") return "ended";
  return "unavailable";
}

function sanitizePublicResult(result) {
  const transportStatus = normalizeTransportStatus(result?.transportStatus);
  const status = typeof result?.status === "string" && result.status ? result.status : "error";
  const out = {
    ok: result?.ok === true,
    status,
    transportInstalled: result?.transportInstalled === true,
    transportEnabled: result?.transportEnabled === true,
    transportStatus,
    uiPhase: UI_PHASES.includes(result?.uiPhase)
      ? result.uiPhase
      : uiPhaseFromNative(status, transportStatus),
  };
  if (result?.error) out.error = String(result.error).slice(0, 64);
  if (result?.credentialRotationUnsupported === true) out.credentialRotationUnsupported = true;
  if (result?.credentialLifecycleUnsupported === true) out.credentialLifecycleUnsupported = true;
  for (const key of Object.keys(out)) {
    if (!PUBLIC_RESULT_KEYS.includes(key)) delete out[key];
  }
  return out;
}

module.exports = {
  TRANSPORT_STATUSES,
  UI_PHASES,
  PUBLIC_RESULT_KEYS,
  isTransportStatus,
  normalizeTransportStatus,
  uiPhaseFromNative,
  sanitizePublicResult,
};
