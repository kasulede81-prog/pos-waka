import { useMemo } from "react";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { useAuth } from "./useAuth";
import { resolveTerminalIdentityView, type TerminalIdentityView } from "../lib/terminalIdentity";

function jwtOperatorDisplayName(
  user: { user_metadata?: Record<string, unknown>; email?: string | null } | null,
): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, string> | undefined;
  return meta?.full_name?.trim() || user.email?.trim() || null;
}

export function useTerminalIdentity(): TerminalIdentityView {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const { user } = useAuth();

  return useMemo(
    () => resolveTerminalIdentityView(actor, preferences, jwtOperatorDisplayName(user)),
    [actor, preferences, user],
  );
}
