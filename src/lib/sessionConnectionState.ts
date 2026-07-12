export type SessionConnectionState = "online" | "offline_cached" | "reconnecting";

let connectionState: SessionConnectionState = "online";
const listeners = new Set<(state: SessionConnectionState) => void>();

export function getSessionConnectionState(): SessionConnectionState {
  return connectionState;
}

export function setSessionConnectionState(next: SessionConnectionState): void {
  if (connectionState === next) return;
  connectionState = next;
  for (const fn of listeners) fn(next);
}

export function subscribeSessionConnectionState(
  listener: (state: SessionConnectionState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetSessionConnectionState(): void {
  setSessionConnectionState("online");
}
