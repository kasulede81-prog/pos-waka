/**
 * Loyalty NFC identification adapter (Phase 07).
 *
 * Merchant device reads an NDEF tag/card carrying the membership payload
 * (`WAKA-LOYALTY:<qr_token>`) and resolves it through the same
 * `loyalty_account_by_token` path as QR scanning. NFC is IDENTIFICATION
 * ONLY: the raw payload is never trusted for points — awarding still comes
 * from the completed-sale trigger server-side.
 *
 * Mechanism: Web NFC (NDEFReader) where the platform exposes it (Chrome
 * Android on secure contexts, some Capacitor WebViews). Devices without it
 * fail gracefully — QR and phone search remain the fallback.
 *
 * Feasibility notes (real-device matrix) live in
 * docs/waka-loyalty-prompts/docs/loyalty/NFC-FEASIBILITY.md.
 */

import { decodeLoyaltyQrPayload } from "../../lib/loyalty/loyaltyEnrollment";

// ---------- Minimal Web NFC ambient types (not yet in lib.dom everywhere) ----------

export type NdefLikeRecord = {
  recordType: string;
  mediaType?: string;
  lang?: string;
  encoding?: string;
  data?: ArrayBuffer | DataView | Uint8Array | null;
};

export type NdefLikeMessage = { records: NdefLikeRecord[] };

export type NdefReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (
    type: "reading" | "readingerror",
    listener: ((event: unknown) => void) | EventListenerOrEventListenerObject | null,
  ) => void;
};

function resolveNdefReaderCtor(): (new () => NdefReaderLike) | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { NDEFReader?: new () => NdefReaderLike }).NDEFReader;
  return typeof ctor === "function" ? ctor : null;
}

// ---------- Capability detection ----------

export type NfcCapabilities = {
  nfc: boolean;
  /** Human-readable reason when unavailable (for UI hinting). */
  reason: "unsupported" | "insecure_context" | "available" | "unknown";
};

export function detectNfcCapabilities(
  ndefReaderCtor: (new () => NdefReaderLike) | null = resolveNdefReaderCtor(),
  env: { secureContext: boolean } | null =
    typeof window === "undefined" ? null : { secureContext: window.isSecureContext },
): NfcCapabilities {
  if (env === null) return { nfc: false, reason: "unknown" };
  if (!ndefReaderCtor) return { nfc: false, reason: "unsupported" };
  if (!env.secureContext) return { nfc: false, reason: "insecure_context" };
  return { nfc: true, reason: "available" };
}

// ---------- Payload extraction (pure, unit-tested) ----------

function recordBytes(record: NdefLikeRecord): Uint8Array | null {
  const data = record.data;
  if (data == null) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof DataView !== "undefined" && data instanceof DataView) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

/**
 * Extracts a loyalty token from NDEF records. Accepts text and URL records
 * whose content is a `WAKA-LOYALTY:` payload. Anything else returns null —
 * product stickers, empty tags, and foreign payloads are ignored.
 */
export function extractLoyaltyTokenFromNdefRecords(records: NdefLikeRecord[]): string | null {
  for (const record of records) {
    const bytes = recordBytes(record);
    if (!bytes || bytes.length === 0) continue;
    let text: string | null = null;
    if (record.recordType === "text") {
      try {
        text = new TextDecoder(record.encoding === "utf-16" ? "utf-16" : "utf-8").decode(bytes);
      } catch {
        continue;
      }
    } else if (record.recordType === "url") {
      try {
        text = new TextDecoder("utf-8").decode(bytes);
      } catch {
        continue;
      }
    }
    if (!text) continue;
    const token = decodeLoyaltyQrPayload(text);
    if (token) return token;
  }
  return null;
}

// ---------- Session ----------

let activeController: AbortController | null = null;

export type NfcSessionResult = { ok: true } | { ok: false; error: string };

/**
 * Starts an NFC reading session. The first membership tag tapped while the
 * session is active resolves `onToken`; the caller performs the account
 * lookup (same as QR scanning).
 */
export async function startNfcSession(opts: {
  ndefReader?: NdefReaderLike;
  onToken: (token: string) => void;
  onError?: (message: string) => void;
}): Promise<NfcSessionResult> {
  const ctor = resolveNdefReaderCtor();
  const reader = opts.ndefReader ?? (ctor ? new ctor() : null);
  if (!reader) return { ok: false, error: "nfc_unsupported" };

  await stopNfcSession();
  const controller = new AbortController();
  activeController = controller;

  try {
    reader.addEventListener("reading", (event: unknown) => {
      const message = (event as { message?: NdefLikeMessage }).message;
      const records = Array.isArray(message?.records) ? message!.records : [];
      const token = extractLoyaltyTokenFromNdefRecords(records);
      if (token) opts.onToken(token);
    });
    reader.addEventListener("readingerror", () => {
      opts.onError?.("nfc_read_error");
    });
    await reader.scan({ signal: controller.signal });
    return { ok: true };
  } catch (error) {
    activeController = null;
    return {
      ok: false,
      error: error instanceof DOMException && error.name === "NotAllowedError"
        ? "nfc_permission_denied"
        : "nfc_start_failed",
    };
  }
}

/** Aborts the active session (if any). Safe to call when none is active. */
export async function stopNfcSession(): Promise<void> {
  if (!activeController) return;
  const controller = activeController;
  activeController = null;
  try {
    controller.abort();
  } catch {
    /* already stopped */
  }
}
