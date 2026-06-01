/**
 * Local-only pilot troubleshooting event log (never synced to cloud).
 */

import type { AuditAction } from "../types";
import { getActiveAccountKey } from "../offline/accountScope";

const BASE_KEY = "waka.pilot.events.v1";
const MAX_EVENTS = 200;

export type PilotEventKind =
  | "login"
  | "logout"
  | "restore"
  | "archive"
  | "sync_failure"
  | "debt_adjustment"
  | "void"
  | "return"
  | "day_close"
  | "other";

export type PilotEventEntry = {
  id: string;
  at: string;
  kind: PilotEventKind;
  summary: string;
  meta?: Record<string, string | number | boolean | null>;
};

function scopedKey(): string | null {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  return `${BASE_KEY}::${acc}`;
}

function readRaw(): PilotEventEntry[] {
  try {
    const k = scopedKey();
    if (!k) return [];
    const raw = localStorage.getItem(k);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PilotEventEntry =>
        Boolean(e && typeof e === "object" && typeof (e as PilotEventEntry).at === "string"),
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: PilotEventEntry[]): void {
  try {
    const k = scopedKey();
    if (!k) return;
    localStorage.setItem(k, JSON.stringify(entries.slice(0, MAX_EVENTS)));
  } catch {
    /* quota */
  }
}

export function appendPilotEvent(
  kind: PilotEventKind,
  summary: string,
  meta?: PilotEventEntry["meta"],
): void {
  const entry: PilotEventEntry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    summary: summary.slice(0, 240),
    meta,
  };
  writeRaw([entry, ...readRaw()].slice(0, MAX_EVENTS));
}

export function readPilotEvents(limit = 50): PilotEventEntry[] {
  return readRaw().slice(0, limit);
}

const AUDIT_TO_PILOT: Partial<Record<AuditAction, PilotEventKind>> = {
  sale_void: "void",
  sale_return: "return",
  debt_payment: "debt_adjustment",
  day_close: "day_close",
};

export function logPilotEventFromAudit(action: AuditAction, summary: string, payload: Record<string, unknown>): void {
  const kind = AUDIT_TO_PILOT[action];
  if (!kind) return;
  const meta: PilotEventEntry["meta"] = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      meta[k] = v;
    }
  }
  appendPilotEvent(kind, summary, meta);
}
