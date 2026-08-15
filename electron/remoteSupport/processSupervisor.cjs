"use strict";

/**
 * The only Remote Support module allowed to spawn a process.
 * Used solely for the lab transport executable. Not exposed to React.
 */

const { spawn } = require("node:child_process");
const { logRemoteSupportEvent } = require("./log.cjs");

function sanitizeProcessOutput(chunk) {
  const text = String(chunk ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!text) return "";
  if (/(password|grant_jti|access_token|refresh.token|service[\W_]?role|secret|private[\W_]?key)/i.test(text)) {
    return "[redacted]";
  }
  return text;
}

function createProcessSupervisor(deps = {}) {
  const spawnFn = typeof deps.spawn === "function" ? deps.spawn : spawn;
  let child = null;
  let requestedStop = false;
  let crashed = false;
  let onCrash = typeof deps.onCrash === "function" ? deps.onCrash : null;

  function running() {
    return Boolean(child && child.exitCode == null && (child.killed !== true || child.pid));
  }

  function attach(next) {
    child = next;
    requestedStop = false;
    if (child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", (chunk) => {
        const safe = sanitizeProcessOutput(chunk);
        if (safe) logRemoteSupportEvent("transport_error", { error: "proc_out" });
      });
    }
    if (child.stderr && typeof child.stderr.on === "function") {
      child.stderr.on("data", (chunk) => {
        const safe = sanitizeProcessOutput(chunk);
        if (safe) logRemoteSupportEvent("transport_error", { error: "proc_err" });
      });
    }
    if (typeof child.on === "function") {
      child.on("exit", () => {
        child = null;
        if (!requestedStop) {
          crashed = true;
          logRemoteSupportEvent("transport_error", { error: "transport_crashed" });
          if (onCrash) onCrash();
        }
      });
    }
  }

  return {
    isRunning() {
      return running();
    },
    hasCrashed() {
      return crashed;
    },
    start(executable, args) {
      if (crashed) return { ok: false, error: "transport_failed" };
      if (running()) return { ok: false, error: "already_running" };
      if (typeof executable !== "string" || !executable) {
        return { ok: false, error: "executable_not_allowlisted" };
      }
      const argv = Array.isArray(args) ? args.map((part) => String(part)) : [];
      if (argv.some((part) => /[|&;<>`$]/.test(part))) {
        return { ok: false, error: "unsafe_argument" };
      }
      let spawned;
      try {
        spawned = spawnFn(executable, argv, {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        return { ok: false, error: "spawn_failed" };
      }
      if (!spawned) return { ok: false, error: "spawn_failed" };
      attach(spawned);
      logRemoteSupportEvent("transport_started", { status: "transport_starting" });
      return { ok: true };
    },
    async stop() {
      requestedStop = true;
      crashed = false;
      if (!child) return { ok: true };
      try {
        if (typeof child.kill === "function") child.kill();
      } catch {
        logRemoteSupportEvent("transport_error", { error: "stop_failed" });
      }
      child = null;
      return { ok: true };
    },
    setOnCrash(handler) {
      onCrash = handler;
    },
  };
}

module.exports = { createProcessSupervisor, sanitizeProcessOutput };
