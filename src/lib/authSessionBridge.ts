import type { Session } from "@supabase/supabase-js";

type AuthSessionBridgeListener = (session: Session) => void;

const listeners = new Set<AuthSessionBridgeListener>();

/** Subscribe to session published from AuthCallback before React auth state catches up. */
export function subscribeAuthSessionBridge(listener: AuthSessionBridgeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish session established in AuthCallback so useAuth can route before onAuthStateChange. */
export function publishAuthSessionFromCallback(session: Session): void {
  for (const fn of listeners) fn(session);
}
