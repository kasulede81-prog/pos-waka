"use strict";

function publicStatus() {
  return {
    ok: false,
    transportStatus: "transport_unavailable",
    transportInstalled: false,
    transportEnabled: false,
    error: "transport_disabled",
    credentialRotationUnsupported: true,
  };
}

/** Default production adapter: transport remains OFF. */
function createDisabledRemoteSupportTransport() {
  return {
    installState() {
      return { installed: false, enabled: false };
    },
    isAvailable() {
      return false;
    },
    async startAuthorizedSession() {
      return publicStatus();
    },
    async stopSession() {
      return { ...publicStatus(), ok: true, error: undefined };
    },
    getSessionStatus() {
      return { ...publicStatus(), ok: true };
    },
    async disconnectSession() {
      return { ...publicStatus(), ok: true, error: undefined };
    },
    async rotateCredentials() {
      return { ...publicStatus(), credentialRotationUnsupported: true };
    },
    async shutdown() {
      return { ...publicStatus(), ok: true, error: undefined };
    },
  };
}

module.exports = { createDisabledRemoteSupportTransport };
