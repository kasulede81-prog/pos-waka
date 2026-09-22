import type { CashDrawerAuditEntry } from "../types";

export type HomeDrawerKick = {
  id: string;
  ok: boolean;
  reason: CashDrawerAuditEntry["reason"];
};

export type HomeDrawerVisualState = "idle" | "open" | "failed";

/** Presentation-only mapping. Does not pulse hardware. */
export function homeDrawerPresentationState(kick: HomeDrawerKick | null, paused: boolean): HomeDrawerVisualState {
  if (paused || !kick) return "idle";
  return kick.ok ? "open" : "failed";
}

export function homeDrawerKickSignature(entry: Pick<CashDrawerAuditEntry, "id" | "at" | "ok"> | null): string | null {
  if (!entry) return null;
  return `${entry.id}:${entry.at}:${entry.ok ? "1" : "0"}`;
}
