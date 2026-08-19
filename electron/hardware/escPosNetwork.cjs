"use strict";

/**
 * LAN ESC/POS TCP transport — Electron main only.
 * Transports already-encoded bytes; no receipt business logic.
 */

const net = require("node:net");
const { validatePrinterArgs } = require("./lanHostValidation.cjs");

const CONNECT_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 10_000;

/**
 * @typedef {{
 *   connect: (opts: { host: string, port: number }, cb: () => void) => import('node:net').Socket,
 * }} NetLike
 */

/**
 * Create a TCP connection with connect + write timeouts and clean teardown.
 * @param {{ host: string, port: number, bytes?: Buffer, mode: "print" | "probe" }} opts
 * @param {{ netModule?: NetLike, connectTimeoutMs?: number, writeTimeoutMs?: number }} [deps]
 */
function runTcpJob(opts, deps = {}) {
  const netModule = deps.netModule || net;
  const connectTimeoutMs = deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const writeTimeoutMs = deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    /** @type {import('node:net').Socket | null} */
    let socket = null;
    let connectTimer = null;
    let writeTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (writeTimer) clearTimeout(writeTimer);
      if (socket) {
        try {
          socket.removeAllListeners();
          socket.destroy();
        } catch {
          /* ignore */
        }
        socket = null;
      }
      resolve(result);
    };

    try {
      socket = netModule.connect({ host: opts.host, port: opts.port }, () => {
        if (settled) return;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }

        if (opts.mode === "probe") {
          finish({
            ok: true,
            code: "connected",
            message: "Printer connected",
            userMessage: "Printer connected",
          });
          return;
        }

        const bytes = opts.bytes;
        if (!bytes || !Buffer.isBuffer(bytes)) {
          finish({
            ok: false,
            code: "malformed_payload",
            error: "Could not connect to printer",
            userMessage: "Could not connect to printer",
          });
          return;
        }

        writeTimer = setTimeout(() => {
          finish({
            ok: false,
            code: "write_timeout",
            error: "Could not connect to printer",
            userMessage: "Could not connect to printer",
            detail: "write_timeout",
          });
        }, writeTimeoutMs);

        socket.write(bytes, (err) => {
          if (settled) return;
          if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
          }
          if (err) {
            finish({
              ok: false,
              code: "write_failed",
              error: "Could not connect to printer",
              userMessage: "Could not connect to printer",
              detail: "write_failed",
            });
            return;
          }
          // Prefer end() for clean close after write; destroy on timeout path.
          try {
            socket.end(() => {
              finish({
                ok: true,
                code: "printed",
                message: "Printer connected",
                userMessage: "Printer connected",
              });
            });
          } catch {
            finish({
              ok: true,
              code: "printed",
              message: "Printer connected",
              userMessage: "Printer connected",
            });
          }
        });
      });

      connectTimer = setTimeout(() => {
        finish({
          ok: false,
          code: "connect_timeout",
          error: "Could not connect to printer",
          userMessage: "Could not connect to printer",
          detail: "connect_timeout",
        });
      }, connectTimeoutMs);

      socket.on("error", () => {
        finish({
          ok: false,
          code: "connection_failed",
          error: "Could not connect to printer",
          userMessage: "Could not connect to printer",
          detail: "connection_failed",
        });
      });
    } catch {
      finish({
        ok: false,
        code: "connection_failed",
        error: "Could not connect to printer",
        userMessage: "Could not connect to printer",
        detail: "connection_failed",
      });
    }
  });
}

async function printEscPos(rawArgs, deps) {
  const validated = validatePrinterArgs(rawArgs, { requireData: true });
  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code,
      error: validated.error,
      userMessage: validated.error,
    };
  }
  return runTcpJob(
    {
      host: validated.host,
      port: validated.port,
      bytes: validated.bytes,
      mode: "print",
    },
    deps,
  );
}

async function testConnection(rawArgs, deps) {
  const validated = validatePrinterArgs(rawArgs ?? {}, { requireData: false });
  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code,
      error: validated.error,
      userMessage: validated.error,
    };
  }
  return runTcpJob(
    {
      host: validated.host,
      port: validated.port,
      mode: "probe",
    },
    deps,
  );
}

async function getStatus(rawArgs, deps) {
  const result = await testConnection(rawArgs, deps);
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      error: result.error,
      userMessage: result.userMessage || "Could not connect to printer",
      status: "unreachable",
    };
  }
  return {
    ok: true,
    code: "reachable",
    message: "Printer connected",
    userMessage: "Printer connected",
    status: "reachable",
  };
}

module.exports = {
  CONNECT_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  printEscPos,
  testConnection,
  getStatus,
  runTcpJob,
};
