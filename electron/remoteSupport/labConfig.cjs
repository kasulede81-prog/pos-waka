"use strict";

/**
 * Locked lab launch plan for RustDesk 1.4.9 documented options.
 * Does not set a permanent password or install a Windows service.
 */

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

function pinIsolatedServer(env = process.env) {
  const idServer = String(env?.WAKA_RUSTDESK_ID_SERVER ?? "").trim();
  const relay = String(env?.WAKA_RUSTDESK_RELAY_SERVER ?? idServer).trim();
  const key = String(env?.WAKA_RUSTDESK_KEY ?? "").trim();
  if (!idServer || !relay || !key) {
    return { ok: false, error: "server_pin_required" };
  }
  if (isPublicRustDeskHost(idServer) || isPublicRustDeskHost(relay)) {
    return { ok: false, error: "public_server_forbidden" };
  }
  if (key.length < 16) {
    return { ok: false, error: "server_key_invalid" };
  }
  return { ok: true, idServer, relay, key };
}

function buildLabArgumentList(server) {
  const args = [];
  for (const [option, value] of VERIFIED_DISABLE_OPTIONS) {
    args.push("--option", option, value);
  }
  args.push("--option", "custom-rendezvous-server", server.idServer);
  args.push("--option", "relay-server", server.relay);
  args.push("--option", "key", server.key);
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
  return {
    ok: true,
    args,
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
  buildLabLaunchPlan,
  hasBootPersistenceArgs,
};
