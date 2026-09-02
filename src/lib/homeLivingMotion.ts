import type { CashDrawerAuditEntry } from "../types";

/** Ambient cycle lengths — compositor-only, 12–30s. */
export const HOME_LIVING_AMBIENT_S = {
  shell: 20,
  drift: 26,
  wash: 24,
  hero: 16,
  icon: 18,
  drawerIdle: 16,
  status: 3.6,
} as const;

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
