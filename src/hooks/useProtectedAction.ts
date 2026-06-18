import { useCallback } from "react";
import type { SensitiveActionKind } from "../lib/sensitiveActionAuth";
import { useSensitiveActionAuth } from "../context/SensitiveActionAuthContext";

/** Run a protected callback after biometric / Owner PIN when the feature is enabled. */
export function useProtectedAction() {
  const { ensureAuthorized } = useSensitiveActionAuth();

  const runProtected = useCallback(
    async (kind: SensitiveActionKind, fn: () => void | Promise<void>): Promise<boolean> => {
      const granted = await ensureAuthorized(kind);
      if (!granted) return false;
      await fn();
      return true;
    },
    [ensureAuthorized],
  );

  return { ensureAuthorized, runProtected };
}
