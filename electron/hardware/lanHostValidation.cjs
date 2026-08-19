"use strict";

/**
 * Conservative LAN printer destination validation.
 * Allows private IPv4 (and link-local) only — no public internet, no loopback.
 */

const DEFAULT_PORT = 9100;
const MIN_PORT = 1;
const MAX_PORT = 65535;
/** Soft cap for a single ESC/POS job (receipts / kitchen tickets). */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Strict dotted-quad without octal-looking leading zeros. */
function parseIPv4(host) {
  const raw = String(host ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const nums = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith("0")) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function isLoopbackIPv4(octets) {
  return octets[0] === 127;
}

function isPrivateOrLinkLocalIPv4(octets) {
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  return false;
}

function isForbiddenSpecialIPv4(octets) {
  if (octets[0] === 0) return true;
  if (octets[0] === 255 && octets[1] === 255 && octets[2] === 255 && octets[3] === 255) {
    return true;
  }
  if (octets[0] >= 224 && octets[0] <= 239) return true;
  return false;
}

/**
 * @returns {{ ok: true, host: string } | { ok: false, code: string, error: string }}
 */
function validatePrinterHost(host) {
  const trimmed = String(host ?? "").trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, code: "invalid_host", error: "Could not connect to printer" };
  }
  if (trimmed === "localhost" || trimmed === "::1" || trimmed === "0.0.0.0") {
    return { ok: false, code: "localhost_rejected", error: "Could not connect to printer" };
  }
  if (/[:/#?\\@]/.test(trimmed) || trimmed.includes("://")) {
    return { ok: false, code: "invalid_host", error: "Could not connect to printer" };
  }

  const octets = parseIPv4(trimmed);
  if (!octets) {
    // Phase 4A: IPv4 LAN printers only (no public DNS destinations).
    return { ok: false, code: "invalid_host", error: "Could not connect to printer" };
  }
  if (isLoopbackIPv4(octets)) {
    return { ok: false, code: "localhost_rejected", error: "Could not connect to printer" };
  }
  if (isForbiddenSpecialIPv4(octets)) {
    return { ok: false, code: "invalid_host", error: "Could not connect to printer" };
  }
  if (!isPrivateOrLinkLocalIPv4(octets)) {
    return { ok: false, code: "public_host_rejected", error: "Could not connect to printer" };
  }
  return { ok: true, host: octets.join(".") };
}

/**
 * @returns {{ ok: true, port: number } | { ok: false, code: string, error: string }}
 */
function validatePrinterPort(port) {
  const n = typeof port === "number" ? port : Number(port);
  if (!Number.isInteger(n) || n < MIN_PORT || n > MAX_PORT) {
    return { ok: false, code: "invalid_port", error: "Could not connect to printer" };
  }
  return { ok: true, port: n };
}

/**
 * @returns {{ ok: true, bytes: Buffer } | { ok: false, code: string, error: string }}
 */
function validateEscPosPayload(data) {
  if (!Array.isArray(data)) {
    return { ok: false, code: "malformed_payload", error: "Could not connect to printer" };
  }
  if (data.length === 0) {
    return { ok: false, code: "malformed_payload", error: "Could not connect to printer" };
  }
  if (data.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, code: "payload_too_large", error: "Could not connect to printer" };
  }
  const bytes = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      return { ok: false, code: "malformed_payload", error: "Could not connect to printer" };
    }
    bytes[i] = v;
  }
  return { ok: true, bytes };
}

/**
 * Strict args for print / test / status — only host, port, data (data optional for test/status).
 */
function validatePrinterArgs(raw, { requireData }) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "invalid_args", error: "Could not connect to printer" };
  }
  const keys = Object.keys(raw);
  const allowed = new Set(["host", "port", "data"]);
  for (const key of keys) {
    if (!allowed.has(key)) {
      return { ok: false, code: "invalid_args", error: "Could not connect to printer" };
    }
  }

  const hostResult = validatePrinterHost(raw.host);
  if (!hostResult.ok) return hostResult;

  const portResult = validatePrinterPort(
    raw.port == null || raw.port === "" ? DEFAULT_PORT : raw.port,
  );
  if (!portResult.ok) return portResult;

  if (requireData) {
    const payload = validateEscPosPayload(raw.data);
    if (!payload.ok) return payload;
    return {
      ok: true,
      host: hostResult.host,
      port: portResult.port,
      bytes: payload.bytes,
    };
  }

  return {
    ok: true,
    host: hostResult.host,
    port: portResult.port,
  };
}

module.exports = {
  DEFAULT_PORT,
  MIN_PORT,
  MAX_PORT,
  MAX_PAYLOAD_BYTES,
  parseIPv4,
  validatePrinterHost,
  validatePrinterPort,
  validateEscPosPayload,
  validatePrinterArgs,
  isPrivateOrLinkLocalIPv4,
};
