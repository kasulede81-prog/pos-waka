import { useCallback, useEffect, useState } from "react";
import { fetchRemoteSupportPlatformSettings } from "../lib/remoteSupport";

const POLL_MS = 60_000;

/**
 * POS/admin UI gate for RS-FREEZE-1. Defaults to OFF until the server says enabled.
 */
export function useRemoteSupportPlatformEnabled() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const settings = await fetchRemoteSupportPlatformSettings();
      setEnabled(settings.enabled === true);
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { enabled, loading, refresh };
}
