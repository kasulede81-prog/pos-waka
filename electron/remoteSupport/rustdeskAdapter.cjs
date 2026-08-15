"use strict";

/**
 * RustDesk transport adapter — LAB ONLY.
 *
 * Launch is permitted only when:
 * - WAKA_REMOTE_SUPPORT_TRANSPORT=lab
 * - native authorization already succeeded (enforced by Support Agent)
 * - executable is allowlisted
 * - isolated server is pinned
 *
 * Never marks transport_active merely because the process started.
 * Never installs a Windows service or sets a permanent password.
 */

const { resolveLabExecutable, ignoreRendererLaunchInput } = require("./processAllowlist.cjs");
const { buildLabLaunchPlan } = require("./labConfig.cjs");
const { createProcessSupervisor } = require("./processSupervisor.cjs");

function createRustDeskTransportAdapter(options = {}) {
  const labEnabled = options.labEnabled === true;
  const env = options.env || process.env;
  const supervisor = options.supervisor || createProcessSupervisor();
  const connectionProbe = typeof options.connectionProbe === "function" ? options.connectionProbe : () => false;
  let state = "transport_unavailable";
  let lastError = labEnabled ? "lab_not_ready" : "transport_disabled";
  let crashed = false;

  function currentError() {
    if (!labEnabled) return "transport_disabled";
    if (crashed) return "transport_failed";
    return lastError;
  }

  function publicStatus(ok = false, extra = {}) {
    const transportStatus = extra.transportStatus || state;
    const out = {
      ok,
      transportStatus,
      transportInstalled: labEnabled && lastError !== "executable_not_allowlisted" && lastError !== "lab_dir_not_configured",
      transportEnabled: labEnabled,
      credentialRotationUnsupported: true,
      credentialLifecycleUnsupported: true,
    };
    const error = extra.error || (!ok ? currentError() : undefined);
    if (error) out.error = error;
    return out;
  }

  function refreshReadiness() {
    if (!labEnabled) {
      state = "transport_unavailable";
      lastError = "transport_disabled";
      return false;
    }
    if (crashed) {
      state = "transport_failed";
      lastError = "transport_failed";
      return false;
    }
    const exe = resolveLabExecutable({
      env,
      appPaths: options.appPaths,
      fs: options.fs,
      rendererPayload: options.rendererPayload,
    });
    const plan = buildLabLaunchPlan({ env });
    if (!exe.ok) {
      state = "transport_unavailable";
      lastError = exe.error;
      return false;
    }
    if (!plan.ok) {
      state = "transport_unavailable";
      lastError = plan.error;
      return false;
    }
    if (state === "transport_unavailable") {
      state = "transport_stopped";
      lastError = undefined;
    }
    return true;
  }

  supervisor.setOnCrash(() => {
    crashed = true;
    state = "transport_failed";
    lastError = "transport_failed";
  });

  refreshReadiness();

  return {
    installState() {
      const ready = refreshReadiness();
      return { installed: ready || state === "transport_stopped", enabled: labEnabled };
    },
    isAvailable() {
      return refreshReadiness() && !crashed && state !== "transport_failed";
    },
    async startAuthorizedSession(rendererPayload) {
      ignoreRendererLaunchInput(rendererPayload);
      if (!labEnabled) return publicStatus(false, { error: "transport_disabled" });
      if (crashed) {
        state = "transport_failed";
        return publicStatus(false, { transportStatus: "transport_failed", error: "transport_failed" });
      }
      const exe = resolveLabExecutable({
        env,
        appPaths: options.appPaths,
        fs: options.fs,
        rendererPayload,
      });
      const plan = buildLabLaunchPlan({ env });
      if (!exe.ok) {
        lastError = exe.error;
        state = "transport_unavailable";
        return publicStatus(false);
      }
      if (!plan.ok) {
        lastError = plan.error;
        state = "transport_unavailable";
        return publicStatus(false);
      }
      state = "transport_starting";
      const spawned = supervisor.start(exe.path, plan.args);
      if (!spawned.ok) {
        lastError = spawned.error;
        state = spawned.error === "transport_failed" ? "transport_failed" : "transport_unavailable";
        return publicStatus(false);
      }
      state = "transport_ready";
      if (connectionProbe() === true) {
        state = "transport_active";
      }
      lastError = undefined;
      return publicStatus(true);
    },
    async stopSession() {
      state = "transport_stopping";
      await supervisor.stop();
      crashed = false;
      state = "transport_stopped";
      lastError = undefined;
      refreshReadiness();
      return publicStatus(true, { transportStatus: state });
    },
    getSessionStatus() {
      if (crashed) state = "transport_failed";
      else if (labEnabled && supervisor.isRunning() && state === "transport_ready" && connectionProbe() === true) {
        state = "transport_active";
      }
      return publicStatus(true, { error: crashed ? "transport_failed" : lastError });
    },
    async disconnectSession() {
      if (supervisor.isRunning()) {
        state = "transport_stopping";
        await supervisor.stop();
      }
      if (!crashed) state = "transport_stopped";
      return publicStatus(true);
    },
    async rotateCredentials() {
      return publicStatus(false, {
        error: "credential_rotation_unsupported",
        transportStatus: state,
      });
    },
    async shutdown() {
      await supervisor.stop();
      crashed = false;
      state = "transport_stopped";
      refreshReadiness();
      return publicStatus(true);
    },
    _testSupervisor() {
      return supervisor;
    },
  };
}

module.exports = { createRustDeskTransportAdapter };
