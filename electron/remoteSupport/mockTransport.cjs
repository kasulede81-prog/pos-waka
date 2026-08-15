"use strict";

/**
 * In-memory transport for automated tests.
 * Never talks to a real desktop, never stores secrets outside this process.
 */

function createMockRemoteSupportTransport() {
  let state = "transport_stopped";
  let credential = newInMemorySecret();
  let startedOnce = false;

  function publicStatus(ok = true, error) {
    const out = {
      ok,
      transportStatus: state,
      transportInstalled: true,
      transportEnabled: true,
      credentialRotationUnsupported: false,
    };
    if (error) out.error = error;
    return out;
  }

  return {
    installState() {
      return { installed: true, enabled: true };
    },
    isAvailable() {
      return state !== "transport_failed";
    },
    async startAuthorizedSession() {
      if (state === "transport_failed") {
        return publicStatus(false, "transport_failed");
      }
      state = "transport_starting";
      state = "transport_ready";
      state = "transport_connecting";
      state = "transport_active";
      startedOnce = true;
      return publicStatus(true);
    },
    async stopSession() {
      if (state === "transport_active" || state === "transport_connecting" || state === "transport_ready") {
        state = "transport_stopping";
      }
      state = "transport_stopped";
      return publicStatus(true);
    },
    getSessionStatus() {
      return publicStatus(true);
    },
    async disconnectSession() {
      if (state === "transport_active") state = "transport_stopping";
      if (state === "transport_stopping") state = "transport_stopped";
      return publicStatus(true);
    },
    async rotateCredentials() {
      credential = newInMemorySecret();
      return { ...publicStatus(true), credentialRotationUnsupported: false };
    },
    async shutdown() {
      state = "transport_stopped";
      credential = null;
      return publicStatus(true);
    },
    /** Test-only: simulate a crash. Does not auto-restart. */
    crash() {
      state = "transport_failed";
    },
    /** Test-only: inspect the in-memory secret. Never exposed over IPC. */
    _testCredential() {
      return credential;
    },
    _testStartedOnce() {
      return startedOnce;
    },
  };
}

function newInMemorySecret() {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { createMockRemoteSupportTransport };
