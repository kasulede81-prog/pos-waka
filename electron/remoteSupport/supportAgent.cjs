"use strict";

const { validateCurrentRemoteSupportAuthorization } = require("./authorizationProvider.cjs");
const { createTransportFromFlag } = require("./transportFactory.cjs");
const { sanitizePublicResult, uiPhaseFromNative } = require("./transportTypes.cjs");
const { logRemoteSupport, logRemoteSupportEvent } = require("./log.cjs");

/**
 * In-process Support Agent.
 *
 * Lifecycle: not running unless an authorized start is requested.
 * Not a Windows service. Does not auto-start on POS launch or reboot.
 * Lab mode may start an allowlisted transport process via the supervisor.
 */
function createSupportAgent(deps = {}) {
  let nativeStatus = "idle";
  let boundFingerprint = null;
  let agentState = "not_running";
  function createBoundTransport() {
    return createTransportFromFlag(deps.env, {
      mode: deps.transportMode,
      supervisor: deps.supervisor,
      fs: deps.fs,
      appPaths: deps.appPaths,
      connectionProbe: deps.connectionProbe,
    });
  }

  let transport = deps.transport || createBoundTransport();
  const loadSnapshot = deps.loadSnapshot;

  function transportPublic() {
    const raw = transport.getSessionStatus();
    return {
      transportInstalled: raw.transportInstalled === true,
      transportEnabled: raw.transportEnabled === true,
      transportStatus: raw.transportStatus || "transport_unavailable",
      credentialRotationUnsupported: raw.credentialRotationUnsupported === true,
      credentialLifecycleUnsupported: raw.credentialLifecycleUnsupported === true,
      error: raw.error,
    };
  }

  function publicResult(ok, extra = {}) {
    const t = transportPublic();
    return sanitizePublicResult({
      ok,
      status: extra.status || nativeStatus,
      error: extra.error || (ok ? undefined : t.error),
      transportInstalled: t.transportInstalled,
      transportEnabled: t.transportEnabled,
      transportStatus: extra.transportStatus || t.transportStatus,
      credentialRotationUnsupported: t.credentialRotationUnsupported,
      credentialLifecycleUnsupported: t.credentialLifecycleUnsupported,
      uiPhase: uiPhaseFromNative(extra.status || nativeStatus, extra.transportStatus || t.transportStatus),
    });
  }

  async function validateNow(rendererPayload) {
    if (!loadSnapshot) {
      return {
        authorized: false,
        status: "error",
        error: "control_plane_unavailable",
      };
    }
    let snapshot;
    try {
      snapshot = await loadSnapshot();
    } catch {
      return {
        authorized: false,
        status: "error",
        error: "control_plane_unavailable",
      };
    }
    return validateCurrentRemoteSupportAuthorization({
      snapshot,
      boundFingerprint,
      rendererPayload,
    });
  }

  async function failClosedStop(status, error) {
    const disconnectFields = { status: status || nativeStatus };
    if (error) disconnectFields.error = error;
    logRemoteSupportEvent("transport_disconnected", disconnectFields);
    try {
      await transport.disconnectSession();
    } catch {
      logRemoteSupportEvent("transport_error", { error: "disconnect_failed" });
    }
    try {
      await transport.stopSession();
    } catch {
      logRemoteSupportEvent("transport_error", { error: "stop_failed" });
    }
    let rotationUnsupported = false;
    try {
      const rotated = await transport.rotateCredentials();
      rotationUnsupported = rotated?.credentialRotationUnsupported === true;
      if (rotationUnsupported) {
        logRemoteSupportEvent("transport_error", { error: "credential_rotation_unsupported" });
      } else if (rotated?.ok) {
        logRemoteSupportEvent("transport_credential_rotated", { status: "stopped" });
      }
    } catch {
      logRemoteSupportEvent("transport_error", { error: "credential_rotation_failed" });
    }
    try {
      await transport.shutdown();
    } catch {
      /* fail-closed continues */
    }
    if (!deps.transport) {
      transport = createBoundTransport();
    }
    agentState = "not_running";
    nativeStatus = status || "stopped";
    logRemoteSupportEvent("transport_stopped", { status: nativeStatus });
    logRemoteSupport("agent exited");
    return publicResult(true, { status: nativeStatus, error, credentialRotationUnsupported: rotationUnsupported });
  }

  async function requestAuthorizationCheck(rendererPayload) {
    logRemoteSupport("authorization check started");
    const result = await validateNow(rendererPayload);
    if (!result.authorized) {
      nativeStatus = result.status || "not_authorized";
      if (agentState === "running") {
        await failClosedStop(nativeStatus, result.error || "remote_support_not_authorized");
      }
      if (result.error === "wrong_device") {
        logRemoteSupport("authorization rejected: wrong device");
      } else if (result.error === "control_plane_unavailable") {
        logRemoteSupport("authorization rejected: control plane unavailable");
      } else {
        logRemoteSupport("authorization rejected");
      }
      return publicResult(false, {
        status: nativeStatus,
        error: result.error || "remote_support_not_authorized",
      });
    }

    boundFingerprint = result.fingerprint;
    nativeStatus = "authorized_stub";
    logRemoteSupport("authorization accepted for current device");
    return publicResult(true);
  }

  async function startAuthorizedTransport(rendererPayload) {
    logRemoteSupportEvent("transport_start_requested", { status: nativeStatus });
    const result = await validateNow(rendererPayload);
    if (!result.authorized) {
      nativeStatus = result.status || "not_authorized";
      if (agentState === "running") {
        await failClosedStop(nativeStatus, result.error);
      }
      logRemoteSupportEvent("transport_connection_failed", {
        status: nativeStatus,
        error: result.error || "remote_support_not_authorized",
      });
      return publicResult(false, {
        status: nativeStatus,
        error: result.error || "remote_support_not_authorized",
      });
    }

    boundFingerprint = result.fingerprint;
    nativeStatus = "authorized_stub";
    logRemoteSupportEvent("transport_start_authorized", { status: nativeStatus });

    if (!transport.isAvailable()) {
      const current = transport.getSessionStatus();
      logRemoteSupportEvent("transport_connection_failed", {
        status: current.transportStatus,
        error: current.error || "transport_unavailable",
      });
      return publicResult(false, {
        error: current.error || "transport_unavailable",
        transportStatus: current.transportStatus || "transport_unavailable",
      });
    }

    agentState = "running";
    logRemoteSupport("agent launched");
    let started;
    try {
      started = await transport.startAuthorizedSession();
    } catch {
      logRemoteSupportEvent("transport_error", { error: "transport_start_threw" });
      await failClosedStop("error", "transport_error");
      return publicResult(false, { status: "error", error: "transport_error" });
    }

    const current = transport.getSessionStatus();
    if (!started?.ok) {
      logRemoteSupportEvent("transport_connection_failed", {
        status: current.transportStatus,
        error: started?.error || current.error || "transport_unavailable",
      });
      agentState = "not_running";
      return publicResult(false, {
        error: started?.error || current.error || "transport_unavailable",
        transportStatus: current.transportStatus,
      });
    }
    const launched = new Set([
      "transport_starting",
      "transport_ready",
      "transport_connecting",
      "transport_active",
    ]);
    if (!launched.has(current.transportStatus)) {
      logRemoteSupportEvent("transport_connection_failed", {
        status: current.transportStatus,
        error: "transport_not_active",
      });
      agentState = "not_running";
      return publicResult(false, {
        error: "transport_not_active",
        transportStatus: current.transportStatus,
      });
    }
    logRemoteSupportEvent("transport_started", { status: current.transportStatus });
    return publicResult(true);
  }

  async function stopTransport() {
    return failClosedStop("stopped");
  }

  return {
    getStatus() {
      return publicResult(true);
    },
    getTransportStatus() {
      return publicResult(true);
    },
    requestAuthorizationCheck,
    startAuthorizedTransport,
    stopTransport,
    stopSession: stopTransport,
    _testAgentState() {
      return agentState;
    },
    _testTransport() {
      return transport;
    },
  };
}

module.exports = { createSupportAgent };
