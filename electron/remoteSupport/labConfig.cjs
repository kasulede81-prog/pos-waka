"use strict";

/**
 * Locked lab launch plan for RustDesk 1.4.9 documented options.
 * Does not set a permanent password or install a Windows service.
 * Isolated server key is written to a lab-dir config file, not process argv.
 */

const path = require("node:path");
const fs = require("node:fs");

const PUBLIC_SERVER_MARKERS = [
  "rustdesk.com",
  "rs-ny.rustdesk.com",
  "rs-sg.rustdesk.com",
  "rs-cn.rustdesk.com",
];

const VERIFIED_DISABLE_OPTIONS = Object.freeze([
  ["enable-file-transfer", "N"],
  ["enable-clipboard", "N"],
  ["enable-terminal", "N"],
  ["enable-tunnel", "N"],
  ["enable-audio", "N"],
  ["enable-camera", "N"],
  ["enable-record-session", "N"],
  ["enable-remote-restart", "N"],
  ["enable-block-input", "N"],
  ["enable-privacy-mode", "N"],
  ["enable-lan-discovery", "N"],
  ["verification-method", "use-temporary-password"],
  ["direct-server", "N"],
]);

const UNSUPPORTED_REQUIREMENTS = Object.freeze([
  {
    requirement: "remote-shutdown",
    reason: "no first-class 1.4.9 option",
  },
  {
    requirement: "credential-lifecycle",
    reason: "temporary password is client-generated, not a WAKA grant",
  },
  {
    requirement: "connection-active-proof",
    reason: "process start is not a desktop session",
  },
]);

const FORBIDDEN_ARGS = Object.freeze([
  "--password",
  "--install-service",
  "--silent-install",
  "--uninstall",
]);

function isPublicRustDeskHost(value) {
  const host = String(value ?? "").trim().toLowerCase();
  if (!host) return true;
  return PUBLIC_SERVER_MARKERS.some((marker) => host === marker || host.endsWith(`.${marker}`));
}

function isIpv4(host) {
  const parts = String(host ?? "").split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isDnsHostname(host) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
    String(host ?? ""),
  );
}

/** Lab ID/relay host only: IPv4 or DNS, optional :port. No URLs, paths, or public RustDesk SaaS. */
function normalizeLabHost(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "unknown_host_forbidden" };
  if (raw.includes("://") || raw.includes("/") || raw.includes("\\") || raw.includes("@") || raw.includes(" ")) {
    return { ok: false, error: "unknown_host_forbidden" };
  }
  let hostPart = raw;
  let portPart = null;
  const idx = raw.lastIndexOf(":");
  if (idx > 0) {
    hostPart = raw.slice(0, idx);
    portPart = raw.slice(idx + 1);
  }
  if (portPart != null && (!/^\d{1,5}$/.test(portPart) || Number(portPart) < 1 || Number(portPart) > 65535)) {
    return { ok: false, error: "unknown_host_forbidden" };
  }
  if (!isIpv4(hostPart) && !isDnsHostname(hostPart)) {
    return { ok: false, error: "unknown_host_forbidden" };
  }
  if (isPublicRustDeskHost(hostPart)) {
    return { ok: false, error: "public_server_forbidden" };
  }
  return { ok: true, host: raw };
}

function pinIsolatedServer(env = process.env) {
  const idRaw = String(env?.WAKA_RUSTDESK_ID_SERVER ?? "").trim();
  const relayRaw = String(env?.WAKA_RUSTDESK_RELAY_SERVER ?? idRaw).trim();
  const key = String(env?.WAKA_RUSTDESK_KEY ?? "").trim();
  if (!idRaw || !relayRaw || !key) {
    return { ok: false, error: "server_pin_required" };
  }
  const idServer = normalizeLabHost(idRaw);
  const relay = normalizeLabHost(relayRaw);
  if (!idServer.ok) return idServer;
  if (!relay.ok) return relay;
  if (key.length < 16 || /['"\n\r]/.test(key)) {
    return { ok: false, error: "server_key_invalid" };
  }
  return { ok: true, idServer: idServer.host, relay: relay.host, key };
}

function tomlEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function labAppDataDir(labDir) {
  return path.join(path.resolve(labDir), "appdata");
}

function labRustDeskConfigPath(labDir) {
  return path.join(labAppDataDir(labDir), "RustDesk", "config", "RustDesk2.toml");
}

function writeProtectedLabServerConfig(input = {}) {
  const labDir = String(input.labDir ?? "").trim();
  const server = input.server;
  const io = input.fs || fs;
  if (!labDir || !path.isAbsolute(labDir) || labDir.includes("..") || !server?.key) {
    return { ok: false, error: "lab_dir_not_configured" };
  }
  const configPath = labRustDeskConfigPath(labDir);
  const dir = path.dirname(configPath);
  try {
    if (typeof io.mkdirSync === "function") {
      io.mkdirSync(dir, { recursive: true });
    }
    const body = [
      `rendezvous_server = "${tomlEscape(server.idServer)}"`,
      "[options]",
      `custom-rendezvous-server = "${tomlEscape(server.idServer)}"`,
      `relay-server = "${tomlEscape(server.relay)}"`,
      `key = "${tomlEscape(server.key)}"`,
      "",
    ].join("\n");
    io.writeFileSync(configPath, body, { encoding: "utf8", mode: 0o600 });
    if (typeof io.chmodSync === "function") {
      try {
        io.chmodSync(configPath, 0o600);
      } catch {
        /* Windows may ignore chmod */
      }
    }
  } catch {
    return { ok: false, error: "lab_config_write_failed" };
  }
  return { ok: true, path: configPath, appData: labAppDataDir(labDir) };
}

function isSecretEnvKey(key) {
  const k = String(key ?? "").toUpperCase();
  if (k.includes("PASSWORD") || k.includes("SECRET") || k.includes("ACCESS_TOKEN")) return true;
  if (k.includes("GRANT_JTI")) return true;
  if (k.includes("RUSTDESK") && k.includes("KEY")) return true;
  if (k.includes("PRIVATE") && k.includes("KEY")) return true;
  const role = "ROLE";
  if (k.includes("SERVICE") && k.includes(role)) return true;
  return false;
}

function sanitizeTransportChildEnv(env, labDir) {
  const out = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value !== "string") continue;
    if (isSecretEnvKey(key)) continue;
    out[key] = value;
  }
  if (labDir) {
    const appdata = labAppDataDir(labDir);
    out.APPDATA = appdata;
    out.LOCALAPPDATA = appdata;
  }
  return out;
}

function buildLabArgumentList(server) {
  const args = [];
  for (const [option, value] of VERIFIED_DISABLE_OPTIONS) {
    args.push("--option", option, value);
  }
  args.push("--option", "custom-rendezvous-server", server.idServer);
  args.push("--option", "relay-server", server.relay);
  return args;
}

function hasBootPersistenceArgs(args) {
  return args.some((arg) => FORBIDDEN_ARGS.includes(String(arg).toLowerCase()));
}

function buildLabLaunchPlan(input = {}) {
  const env = input.env || process.env;
  const server = pinIsolatedServer(env);
  if (!server.ok) return server;
  const args = buildLabArgumentList(server);
  if (hasBootPersistenceArgs(args)) {
    return { ok: false, error: "boot_persistence_forbidden" };
  }
  if (args.includes(server.key)) {
    return { ok: false, error: "server_key_invalid" };
  }
  const labDir = String(env.WAKA_REMOTE_SUPPORT_LAB_DIR ?? "").trim();
  let configPath = null;
  const childEnv = sanitizeTransportChildEnv(env, labDir || null);
  if (input.writeConfig === true) {
    if (!labDir || !path.isAbsolute(labDir) || labDir.includes("..")) {
      return { ok: false, error: "lab_dir_not_configured" };
    }
    const written = writeProtectedLabServerConfig({ labDir, server, fs: input.fs });
    if (!written.ok) return written;
    configPath = written.path;
  }
  return {
    ok: true,
    args,
    cwd: labDir || undefined,
    childEnv,
    configPath,
    server: { idServer: server.idServer, relay: server.relay },
    unsupported: UNSUPPORTED_REQUIREMENTS,
    credentialLifecycleUnsupported: true,
    credentialRotationUnsupported: true,
    bootPersistence: false,
  };
}

module.exports = {
  PUBLIC_SERVER_MARKERS,
  VERIFIED_DISABLE_OPTIONS,
  UNSUPPORTED_REQUIREMENTS,
  FORBIDDEN_ARGS,
  pinIsolatedServer,
  normalizeLabHost,
  buildLabLaunchPlan,
  hasBootPersistenceArgs,
  writeProtectedLabServerConfig,
  sanitizeTransportChildEnv,
};
