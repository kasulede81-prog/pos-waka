import { createContext, useContext, type ReactNode } from "react";

export type SessionHydrationContextValue = {
  /** True after shop_members role fetch settles (always true for local/staff). */
  roleReady: boolean;
};

const defaultValue: SessionHydrationContextValue = { roleReady: true };

const SessionHydrationContext = createContext<SessionHydrationContextValue>(defaultValue);

export function SessionHydrationProvider({
  roleReady,
  children,
}: {
  roleReady: boolean;
  children: ReactNode;
}) {
  return (
    <SessionHydrationContext.Provider value={{ roleReady }}>{children}</SessionHydrationContext.Provider>
  );
}

export function useSessionHydration(): SessionHydrationContextValue {
  return useContext(SessionHydrationContext);
}
