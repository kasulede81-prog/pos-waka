import { usePosStore } from "../store/usePosStore";
import { isPilotModeActive } from "./pilotMode";

import { authOperatorRole } from "./sessionActor";

/** Verbose sync trace when pilot mode is on (console only — no PII). */
export function pilotSyncLog(code: string, meta?: Record<string, string | number | boolean>): void {
  const state = usePosStore.getState();
  const actor = state.sessionActor;
  if (!actor || !isPilotModeActive(authOperatorRole(actor), state.preferences)) return;
  if (import.meta.env.DEV || state.preferences.pilotModeEnabled) {
    console.info("[waka-pilot-sync]", code, meta ?? {});
  }
}
