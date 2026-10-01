import { useMemo } from "react";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { useAuth } from "./useAuth";
import { resolveTerminalIdentityView, type TerminalIdentityView } from "../lib/terminalIdentity";
import { displayWakaName } from "../lib/nameReview";

function jwtOperatorDisplayName(
  user: { user_metadata?: Record<string, unknown>; email?: string | null } | null,
): string | null {
  if (!user) return null;
  // The confirmed WAKA name first; Google's suggestion only for someone who has not confirmed one.
  // No network call — the metadata is already on this session.
  return displayWakaName(user.user_metadata as Record<string, unknown> | undefined, user.email);
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
