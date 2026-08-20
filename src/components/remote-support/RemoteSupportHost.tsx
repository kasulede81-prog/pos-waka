import { useEffect, useRef } from "react";
import type { Language } from "../../types";
import { useSubscription } from "../../context/SubscriptionContext";
import { useRemoteSupportRequestListener } from "../../hooks/useRemoteSupportRequestListener";
import { useRemoteSupportPlatformEnabled } from "../../hooks/useRemoteSupportPlatformEnabled";
import { appendDeviceAuditEntry } from "../../lib/deviceAudit";
import { getWakaDesktopRemoteSupport } from "../../lib/remoteSupport";
import { RemoteSupportApprovalDialog } from "./RemoteSupportApprovalDialog";
import { RemoteSupportSessionBanner } from "./RemoteSupportSessionBanner";

type Props = { lang: Language };

export function RemoteSupportHost({ lang }: Props) {
  const { snapshot } = useSubscription();
  const shopId = snapshot.kind === "remote" ? snapshot.row.shop_id : null;
  const { enabled: platformEnabled } = useRemoteSupportPlatformEnabled();
  const { inbox, busy, justApproved, uiPhase, allow, decline, endSession } = useRemoteSupportRequestListener(
    platformEnabled ? shopId : null,
  );
  const deliveredRef = useRef<string | null>(null);

  useEffect(() => {
    if (platformEnabled) return;
    const native = getWakaDesktopRemoteSupport();
    void native?.stopTransport();
  }, [platformEnabled]);

  useEffect(() => {
    const id = inbox.request?.id;
    if (!id || deliveredRef.current === id) return;
    deliveredRef.current = id;
    appendDeviceAuditEntry("remote_support_request_delivered", "Remote support request shown on this POS", {
      requestId: id,
      shopId,
    });
  }, [inbox.request?.id, shopId]);

  if (!platformEnabled) return null;

  const showDialog = Boolean(inbox.request) || justApproved;
  const showBanner = Boolean(inbox.session);

  if (!showDialog && !showBanner) return null;

  return (
    <>
      {showBanner && inbox.session ? (
        <RemoteSupportSessionBanner
          lang={lang}
          session={inbox.session}
          uiPhase={uiPhase}
          busy={busy}
          onEnd={() => void endSession()}
        />
      ) : null}
      {showDialog ? (
        <RemoteSupportApprovalDialog
          lang={lang}
          request={inbox.request}
          busy={busy}
          approved={justApproved}
          onDecline={() => void decline()}
          onAllow={() => void allow()}
        />
      ) : null}
    </>
  );
}
