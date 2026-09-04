"use strict";

/**
 * Windows desktop print protocol V1.
 * Accepts only wakapos://print/v1?saleId=… — no auth URLs, no printer fields, no bytes.
 */

const SCHEME = "wakapos:";
const HOST = "print";
const VERSION_PATH = "v1";
const SALE_ID_MAX = 80;

function isValidSaleId(saleId) {
  const id = String(saleId ?? "").trim();
  if (!id || id.length > SALE_ID_MAX) return false;
  if (/[\s#]/.test(id)) return false;
  return true;
}

/**
 * @returns {{ type: "print", version: 1, saleId: string } | null}
 */
function parsePrintProtocolUrl(raw) {
  const value = String(raw ?? "")
    .trim()
    .replace(/^"+|"+$/g, "");
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol.toLowerCase() !== SCHEME) return null;
  if (parsed.hostname.toLowerCase() !== HOST) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (parsed.hash) return null;

  const path = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (path !== VERSION_PATH) return null;

  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "saleId") return null;

  const saleId = parsed.searchParams.get("saleId");
  if (!isValidSaleId(saleId)) return null;

  return { type: "print", version: 1, saleId: String(saleId).trim() };
}

/**
 * Scan process.argv / second-instance commandLine for a single print request.
 * Ignores electron paths, auth URLs, and unrelated flags.
 * @param {unknown} argv
 * @returns {{ type: "print", version: 1, saleId: string } | null}
 */
function extractPrintProtocolFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    const parsed = parsePrintProtocolUrl(arg);
    if (parsed) return parsed;
  }
  return null;
}

module.exports = {
  SALE_ID_MAX,
  isValidSaleId,
  parsePrintProtocolUrl,
  extractPrintProtocolFromArgv,
};
