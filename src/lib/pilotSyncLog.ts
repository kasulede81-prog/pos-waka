import { usePosStore } from "../store/usePosStore";
import { isPilotModeActive } from "./pilotMode";

/** Verbose sync trace when pilot mode is on (console only — no PII). */
export function pilotSyncLog(code: string, meta?: Record<string, string | number | boolean>): void {
  const state = usePosStore.getState();
  const actor = state.sessionActor;
  if (!actor || !isPilotModeActive(actor.role, state.preferences)) return;
  if (import.meta.env.DEV || state.preferences.pilotModeEnabled) {
    console.info("[waka-pilot-sync]", code, meta ?? {});
  }
}
