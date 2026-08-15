import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  mapTicketIssueToReason,
  resolveTicketShopDevice,
  type ResolvedTicketDevice,
} from "../../lib/remoteSupport";
import type { SupportTicketRow } from "../../lib/wakaInternalAdmin";
import { RemoteSupportConnectControl } from "./RemoteSupportConnectControl";

type Props = {
  lang: Language;
  ticket: SupportTicketRow;
  technicianName: string;
  canRemoteSupport: boolean;
  previewMode?: boolean;
};

function failClosedMessage(lang: Language, result: Extract<ResolvedTicketDevice, { ok: false }>): string {
  if (result.error === "device_not_eligible" && result.reason) return result.reason;
  if (result.error === "shop_unavailable") return t(lang, "remoteSupportTicketNoShop");
  if (result.error === "device_fingerprint_missing") return t(lang, "remoteSupportTicketNoDevice");
  if (result.error === "device_not_found" || result.error === "device_shop_mismatch") {
    return t(lang, "remoteSupportTicketDeviceMissing");
  }
  return t(lang, "remoteSupportIneligible");
}

export function RemoteSupportTicketConnect({
  lang,
  ticket,
  technicianName,
  canRemoteSupport,
  previewMode,
}: Props) {
  const [resolved, setResolved] = useState<ResolvedTicketDevice | null>(null);

  useEffect(() => {
    if (!canRemoteSupport) return;
    let cancelled = false;
    void resolveTicketShopDevice({
      shopId: ticket.shop_id,
      deviceFingerprint: ticket.device_fingerprint,
      diagnostics: ticket.diagnostics_json,
    }).then((next) => {
      if (!cancelled) setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [canRemoteSupport, ticket.device_fingerprint, ticket.diagnostics_json, ticket.id, ticket.shop_id]);

  if (!canRemoteSupport) return null;

  if (!resolved) {
    return <p className="mt-2 text-[10px] font-semibold text-muted-foreground">{t(lang, "remoteSupportResolvingDevice")}</p>;
  }

  if (!resolved.ok) {
    return <p className="mt-2 text-[10px] font-semibold text-rose-800">{failClosedMessage(lang, resolved)}</p>;
  }

  return (
    <RemoteSupportConnectControl
      lang={lang}
      shopId={resolved.device.shop_id}
      shopName={ticket.shop_name ?? "Shop"}
      device={resolved.device}
      technicianName={technicianName}
      canRemoteSupport={canRemoteSupport}
      previewMode={previewMode}
      supportRequestId={ticket.id}
      initialReasonCode={mapTicketIssueToReason(ticket.issue_type)}
      initialReasonText={ticket.body || ticket.subject || undefined}
    />
  );
}
