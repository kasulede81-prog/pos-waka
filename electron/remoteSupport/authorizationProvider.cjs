"use strict";

/**
 * RS-2.1 native authorization provider.
 *
 * Decision source: WAKA control-plane inbox for the current device.
 * Renderer-supplied approved/connecting/active/authorized/session_id/grant_jti
 * are never used as proof.
 *
 * Device identity remains localStorage waka-pos-device-id (not hardware auth).
 * The server still binds the inbox to that fingerprint.
 */

const AUTHORIZED_SESSION_STATUSES = new Set(["connecting", "active"]);

function ignoreRendererAuthorizationInput(_raw) {
  return null;
}

function decideFromControlPlane(snapshot, boundFingerprint) {
  if (snapshot?.remoteSupportEnabled !== true) {
    return {
      authorized: false,
      reason: "remote_support_disabled",
      status: "not_authorized",
      error: "remote_support_disabled",
    };
  }
  if (snapshot?.controlPlaneError === "control_plane_unavailable") {
    return {
      authorized: false,
      reason: "control_plane_unavailable",
      status: "error",
      error: "control_plane_unavailable",
    };
  }
  const deviceFingerprint = String(snapshot?.deviceFingerprint ?? "").trim();
  if (deviceFingerprint.length < 8) {
    return {
      authorized: false,
      reason: "missing_identity",
      status: "error",
      error: "missing_identity",
    };
  }
  if (boundFingerprint && boundFingerprint !== deviceFingerprint) {
    return {
      authorized: false,
      reason: "wrong_device",
      status: "error",
      error: "wrong_device",
    };
  }

  const request = snapshot?.inbox?.request;
  const session = snapshot?.inbox?.session;
  if (request?.device_fingerprint && request.device_fingerprint !== deviceFingerprint) {
    return {
      authorized: false,
      reason: "wrong_device",
      status: "error",
      error: "wrong_device",
    };
  }

  const sessionStatus = String(session?.status ?? "").trim().toLowerCase();
  const requestStatus = String(request?.status ?? "").trim().toLowerCase();

  if (AUTHORIZED_SESSION_STATUSES.has(sessionStatus)) {
    return {
      authorized: true,
      sessionStatus,
      deviceBound: true,
      status: "authorized_stub",
      fingerprint: deviceFingerprint,
    };
  }
  if (sessionStatus === "revoked") {
    return { authorized: false, reason: "revoked", sessionStatus, status: "revoked", error: "remote_support_not_authorized" };
  }
  if (sessionStatus === "expired") {
    return { authorized: false, reason: "expired", sessionStatus, status: "expired", error: "remote_support_not_authorized" };
  }
  if (requestStatus === "requested" || requestStatus === "pending") {
    return {
      authorized: false,
      reason: "authorization_pending",
      status: "authorization_pending",
      error: "remote_support_not_authorized",
    };
  }
  return {
    authorized: false,
    reason: "not_authorized",
    sessionStatus: sessionStatus || "no_session",
    status: "not_authorized",
    error: "remote_support_not_authorized",
  };
}

async function validateCurrentRemoteSupportAuthorization(input) {
  ignoreRendererAuthorizationInput(input?.rendererPayload);
  const snapshot = input?.snapshot;
  if (!snapshot) {
    return {
      authorized: false,
      reason: "not_authorized",
      status: "not_authorized",
      error: "remote_support_not_authorized",
    };
  }
  return decideFromControlPlane(snapshot, input?.boundFingerprint ?? null);
}

module.exports = {
  AUTHORIZED_SESSION_STATUSES,
  ignoreRendererAuthorizationInput,
  decideFromControlPlane,
  validateCurrentRemoteSupportAuthorization,
};
