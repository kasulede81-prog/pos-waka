"use strict";

/**
 * Native-only Remote Support transport flag.
 * Default OFF. Renderer / localStorage cannot enable transport.
 *
 * WAKA_REMOTE_SUPPORT_TRANSPORT=off|mock|lab
 * WAKA_REMOTE_SUPPORT_TRANSPORT_LAB_ENABLE=1  (lab adapter selected, still does not spawn)
 */

const ALLOWED_MODES = new Set(["off", "mock", "lab"]);

function readTransportFlag(env = process.env) {
  const raw = String(env?.WAKA_REMOTE_SUPPORT_TRANSPORT ?? "off")
    .trim()
    .toLowerCase();
  return ALLOWED_MODES.has(raw) ? raw : "off";
}

function isLabExplicitlyEnabled(env = process.env) {
  return String(env?.WAKA_REMOTE_SUPPORT_TRANSPORT_LAB_ENABLE ?? "").trim() === "1";
}

function isTransportFeatureOn(env = process.env) {
  const mode = readTransportFlag(env);
  return mode === "mock" || mode === "lab";
}

module.exports = {
  readTransportFlag,
  isLabExplicitlyEnabled,
  isTransportFeatureOn,
};
