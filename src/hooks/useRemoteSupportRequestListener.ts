import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { isInternalAdminAppPath } from "../lib/internalAdminPreview";
import {
  approveRemoteSupport,
  declineRemoteSupport,
  endRemoteSupport,
  fetchRemoteSupportCustomerInbox,
  getWakaDesktopRemoteSupport,
  remoteSupportUiPhase,
  type RemoteSupportInbox,
  type RemoteSupportUiPhase,
} from "../lib/remoteSupport";
import { appendDeviceAuditEntry } from "../lib/deviceAudit";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const FALLBACK_POLL_MS = 20_000;

export function useRemoteSupportRequestListener(shopId: string | null) {
  const location = useLocation();
  const [inbox, setInbox] = useState<RemoteSupportInbox>({ request: null, session: null });
  const [busy, setBusy] = useState(false);
  const [justApproved, setJustApproved] = useState(false);
  const [uiPhase, setUiPhase] = useState<RemoteSupportUiPhase>("unavailable");
  const fingerprint = typeof window === "undefined" ? "" : getOrCreateDeviceId();
  const disabled = !shopId || isInternalAdminAppPath(location.pathname);

  const syncNativeBoundary = useCallback(async (nextInbox?: RemoteSupportInbox) => {
    const requestStatus = nextInbox?.request?.status ?? inbox.request?.status;
    const sessionStatus = nextInbox?.session?.status ?? inbox.session?.status;
    const native = getWakaDesktopRemoteSupport();
    if (!native) {
      setUiPhase(
        remoteSupportUiPhase({
          controlPlaneRequestStatus: requestStatus,
          controlPlaneSessionStatus: sessionStatus,
          transportStatus: "transport_unavailable",
        }),
      );
      return;
    }
    const checked = await native.requestAuthorizationCheck();
    const transport = await native.getTransportStatus();
    setUiPhase(
      remoteSupportUiPhase({
        controlPlaneRequestStatus: requestStatus,
        controlPlaneSessionStatus: sessionStatus,
        transportStatus: transport.transportStatus ?? checked.transportStatus,
      }),
    );
  }, [inbox.request?.status, inbox.session?.status]);

  const refresh = useCallback(async () => {
    if (disabled || !fingerprint) return;
    const next = await fetchRemoteSupportCustomerInbox(fingerprint);
    if (next.request && next.request.device_fingerprint !== fingerprint) {
      const cleaned = { request: null, session: next.session?.shop_device_id ? next.session : null };
      setInbox(cleaned);
      await syncNativeBoundary(cleaned);
      return;
    }
    setInbox(next);
    await syncNativeBoundary(next);
  }, [disabled, fingerprint, syncNativeBoundary]);

  useEffect(() => {
    if (disabled || !hasSupabaseConfig || !supabase || !fingerprint) return;

    void refresh();
    const poll = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);

    // Realtime is a nudge only. After RS-1.2, shop members have no RS SELECT,
    // so postgres_changes will not deliver rows. Inbox RPC is authoritative.
    let channel: RealtimeChannel | null = supabase
      .channel(`waka-remote-support-${fingerprint}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "remote_support_requests",
          filter: `device_fingerprint=eq.${fingerprint}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "remote_support_sessions",
          filter: `shop_id=eq.${shopId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [disabled, fingerprint, refresh, shopId]);

  const allow = useCallback(async () => {
    if (!inbox.request) return;
    setBusy(true);
    const result = await approveRemoteSupport({
      requestId: inbox.request.id,
      deviceFingerprint: fingerprint,
    });
    if (result.ok) {
      setJustApproved(true);
      appendDeviceAuditEntry("remote_support_customer_approved", "Customer approved remote support", {
        requestId: inbox.request.id,
        sessionId: result.session_id,
      });
      const native = getWakaDesktopRemoteSupport();
      if (native) {
        appendDeviceAuditEntry("remote_support_transport_start_requested", "Transport start requested", {
          sessionId: result.session_id,
        });
        const started = await native.startAuthorizedTransport();
        if (started.ok && started.transportStatus === "transport_active") {
          appendDeviceAuditEntry("remote_support_transport_started", "Transport started", {
            sessionId: result.session_id,
            status: started.transportStatus,
          });
        } else {
          appendDeviceAuditEntry(
            "remote_support_transport_connection_failed",
            "Transport did not start",
            { sessionId: result.session_id, status: started.transportStatus, error: started.error },
          );
        }
      }
      window.setTimeout(() => setJustApproved(false), 4000);
    }
    setBusy(false);
    await refresh();
  }, [fingerprint, inbox.request, refresh]);

  const decline = useCallback(async () => {
    if (!inbox.request) return;
    setBusy(true);
    const result = await declineRemoteSupport({
      requestId: inbox.request.id,
      deviceFingerprint: fingerprint,
    });
    setBusy(false);
    if (result.ok) {
      appendDeviceAuditEntry("remote_support_customer_declined", "Customer declined remote support", {
        requestId: inbox.request.id,
      });
    }
    await refresh();
  }, [fingerprint, inbox.request, refresh]);

  const endSession = useCallback(async () => {
    if (!inbox.session) return;
    setBusy(true);
    const result = await endRemoteSupport({
      sessionId: inbox.session.id,
      deviceFingerprint: fingerprint,
    });
    const native = getWakaDesktopRemoteSupport();
    if (native) {
      await native.stopTransport();
      appendDeviceAuditEntry("remote_support_transport_stopped", "Transport stopped", {
        sessionId: inbox.session.id,
      });
      await native.requestAuthorizationCheck();
    }
    setBusy(false);
    if (result.ok) {
      appendDeviceAuditEntry("remote_support_customer_ended", "Customer ended remote support", {
        sessionId: inbox.session.id,
      });
    }
    await refresh();
  }, [fingerprint, inbox.session, refresh]);

  return { inbox, busy, justApproved, uiPhase, allow, decline, endSession };
}
