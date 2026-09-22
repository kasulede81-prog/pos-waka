import type { CashDrawerAuditEntry } from "../types";

/**
 * Ambient cycle lengths (seconds) — mirrored by `--home-motion-*` CSS vars on
 * `.home-cinematic-shell`. Kept exported for tests / JS readers; compositor CSS
 * is the runtime source of truth after Lovable motion hardening.
 */
export const HOME_LIVING_AMBIENT_S = {
  shell: 18,
  drift: 22,
  wash: 24,
  hero: 14,
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
