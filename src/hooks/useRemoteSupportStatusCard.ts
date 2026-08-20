import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { isElectronDesktop } from "../lib/electronDesktop";
import { isInternalAdminAppPath } from "../lib/internalAdminPreview";
import {
  fetchRemoteSupportCustomerInbox,
  getWakaDesktopRemoteSupport,
  remoteSupportUiPhase,
  type RemoteSupportInbox,
  type RemoteSupportUiPhase,
} from "../lib/remoteSupport";
import { hasSupabaseConfig } from "../lib/supabase";

const POLL_MS = 20_000;

export function useRemoteSupportStatusCard(shopId: string | null) {
  const location = useLocation();
  const [inbox, setInbox] = useState<RemoteSupportInbox>({ request: null, session: null });
  const [uiPhase, setUiPhase] = useState<RemoteSupportUiPhase>("unavailable");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fingerprint = typeof window === "undefined" ? "" : getOrCreateDeviceId();
  const disabled = !shopId || isInternalAdminAppPath(location.pathname);

  const refresh = useCallback(async () => {
    if (disabled || !fingerprint) {
      setLoading(false);
      return;
    }
    try {
      const next = await fetchRemoteSupportCustomerInbox(fingerprint);
      setInbox(next);
      const native = getWakaDesktopRemoteSupport();
      const transport = native ? await native.getTransportStatus() : null;
      setUiPhase(
        remoteSupportUiPhase({
          controlPlaneRequestStatus: next.request?.status,
          controlPlaneSessionStatus: next.session?.status,
          transportStatus: transport?.transportStatus ?? "transport_unavailable",
        }),
      );
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [disabled, fingerprint]);

  useEffect(() => {
    if (disabled || !hasSupabaseConfig || !fingerprint) {
      setLoading(false);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [disabled, fingerprint, refresh]);

  return {
    inbox,
    uiPhase,
    loading,
    error,
    deviceId: fingerprint,
    electronDesktop: isElectronDesktop(),
  };
}
