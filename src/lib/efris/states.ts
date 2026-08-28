import { EFRIS_STATES, type EfrisState } from "./types";

export function nextEfrisStateAfterEnqueue(enabled: boolean): EfrisState {
  return enabled ? "PENDING" : "NOT_REQUIRED";
}

/** Phase 1: provider-absent processing never advances to SUBMITTED or ACCEPTED. */
export function mayRecordFakeAcceptance(): false {
  return false;
}

export function isTerminalAccepted(state: EfrisState): boolean {
  return state === "ACCEPTED";
}

export function assertKnownEfrisState(state: string): EfrisState {
  if ((EFRIS_STATES as readonly string[]).includes(state)) return state as EfrisState;
  return "PENDING";
}
