/**
 * WAKA-10 — device-qualified receipt identity.
 *
 * `receiptSeq` stays a per-terminal local counter (offline-safe). Displayed
 * and persisted identity is `(Kampala day, receiptTerminal, receiptSeq)` so
 * two tills cannot print the same number on the same day before sync.
 * Identity is stamped at completion and never rewritten on ACK, pull, or recovery.
 */

import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { scanTodaySalesHead } from "./salesDayIndex";

const TERMINAL_CODE_LENGTH = 4;

export type ReceiptIdentityFields = {
  receiptSeq?: number | null;
  receiptTerminal?: string | null;
};

export function normalizeReceiptTerminal(raw: unknown): string | undefined {
  const compact = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (compact.length < 2 || compact.length > 8) return undefined;
  return compact;
}

export function parseReceiptSeq(raw: unknown): number | undefined {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Stable 4-char till code derived from the install's device id. */
export function receiptTerminalCodeFromDeviceId(deviceId: string): string {
  const compact = deviceId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (compact.length >= TERMINAL_CODE_LENGTH) return compact.slice(0, TERMINAL_CODE_LENGTH);
  return `${compact}XXXX`.slice(0, TERMINAL_CODE_LENGTH);
}

export function mintLocalReceiptIdentity(
  sales: Sale[],
  deviceId: string,
  todayKey = dateKeyKampala(new Date()),
): { receiptSeq: number; receiptTerminal: string } {
  const receiptTerminal = receiptTerminalCodeFromDeviceId(deviceId);
  const receiptSeq = scanTodaySalesHead(sales, todayKey, receiptTerminal).nextReceiptSeq;
  return { receiptSeq, receiptTerminal };
}

export function formatPersistedReceiptIdentity(input: ReceiptIdentityFields): string | null {
  const seq = parseReceiptSeq(input.receiptSeq);
  if (seq == null) return null;
  const terminal = normalizeReceiptTerminal(input.receiptTerminal);
  if (terminal) return `${terminal}-${String(seq).padStart(3, "0")}`;
  return `INV-${String(seq).padStart(6, "0")}`;
}

/**
 * Customer/debt UI: qualified identity when a till code exists; legacy `#014`
 * when only `receiptSeq` was stamped (pre-WAKA-10 rows).
 */
export function formatReceiptIdentityForUi(input: ReceiptIdentityFields): string | null {
  const seq = parseReceiptSeq(input.receiptSeq);
  if (seq == null) return null;
  const terminal = normalizeReceiptTerminal(input.receiptTerminal);
  if (terminal) return `${terminal}-${String(seq).padStart(3, "0")}`;
  return `#${String(seq).padStart(3, "0")}`;
}

/** Collision key for the audit's uniqueness invariant. */
export function saleReceiptIdentityKey(
  sale: ReceiptIdentityFields & { createdAt: string },
): string | null {
  const seq = parseReceiptSeq(sale.receiptSeq);
  if (seq == null) return null;
  const terminal = normalizeReceiptTerminal(sale.receiptTerminal) ?? "_";
  return `${dateKeyKampala(sale.createdAt)}|${terminal}|${seq}`;
}

/** Prefer the locally stamped identity; never let a later cloud row rewrite it. */
export function mergeStampedReceiptIdentity(local: Sale, remote: Sale): Pick<Sale, "receiptSeq" | "receiptTerminal"> {
  return {
    receiptSeq: parseReceiptSeq(local.receiptSeq) ?? parseReceiptSeq(remote.receiptSeq),
    receiptTerminal: normalizeReceiptTerminal(local.receiptTerminal) ?? normalizeReceiptTerminal(remote.receiptTerminal),
  };
}
