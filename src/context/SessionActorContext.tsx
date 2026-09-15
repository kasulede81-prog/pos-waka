import { createContext, useContext, type ReactNode } from "react";
import type { SessionActor } from "../lib/sessionActor";

const SessionActorContext = createContext<SessionActor | null>(null);

export function SessionActorProvider({ value, children }: { value: SessionActor; children: ReactNode }) {
  return <SessionActorContext.Provider value={value}>{children}</SessionActorContext.Provider>;
}

export function useSessionActor(): SessionActor {
  const v = useContext(SessionActorContext);
  if (!v) {
    return { userId: "unknown", role: "cashier" };
  }
  return v;
}
