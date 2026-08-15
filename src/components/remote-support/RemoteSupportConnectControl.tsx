import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  evaluateRemoteSupportEligibility,
  remoteSupportErrorMessage,
  requestRemoteSupport,
  type RemoteSupportEligibilityDevice,
  type RemoteSupportReasonCode,
} from "../../lib/remoteSupport";
import { logInternalAdminAudit } from "../../lib/rescueSupportActions";
import { RemoteSupportRequestDialog } from "./RemoteSupportRequestDialog";

type Props = {
  lang: Language;
  shopId: string;
  shopName: string;
  device: RemoteSupportEligibilityDevice & { id: string; label?: string | null; platform?: string | null };
  technicianName: string;
  canRemoteSupport: boolean;
  previewMode?: boolean;
  onRequested?: (requestId: string) => void;
};

export function RemoteSupportConnectControl({
  lang,
  shopId,
  shopName,
  device,
  technicianName,
  canRemoteSupport,
  previewMode,
  onRequested,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibility = evaluateRemoteSupportEligibility(device);
  const deviceLabel = device.label || (device.platform === "windows" ? "Windows POS" : device.platform || "POS");

  if (!canRemoteSupport) return null;

  const submit = async (reasonCode: RemoteSupportReasonCode, reasonText: string) => {
    if (previewMode) {
      setError("Preview mode — action blocked.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestRemoteSupport({
      shopId,
      shopDeviceId: device.id,
      reasonCode,
      reasonText,
    });
    setBusy(false);
    if (!result.ok) {
      setError(remoteSupportErrorMessage(result));
      await logInternalAdminAudit({
        shopId,
        action: "remote_support_request_created",
        result: "failed",
        reason: result.message ?? result.error,
        metadata: { deviceId: device.id, reasonCode },
      });
      return;
    }
    await logInternalAdminAudit({
      shopId,
      action: "remote_support_request_created",
      result: "ok",
      reason: reasonText,
      metadata: { requestId: result.request_id, deviceId: device.id, reasonCode },
    });
    setOpen(false);
    setWaiting(true);
    if (result.request_id) onRequested?.(result.request_id);
  };

  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        disabled={!eligibility.eligible || previewMode || waiting}
        title={eligibility.eligible ? undefined : eligibility.explanation}
        onClick={() => setOpen(true)}
        className="min-h-[40px] rounded-xl bg-waka-600 px-3 text-[11px] font-black text-white disabled:bg-muted disabled:text-muted-foreground"
      >
        {waiting ? t(lang, "remoteSupportWaiting") : t(lang, "remoteSupportConnect")}
      </button>
      {!eligibility.eligible ? (
        <p className="text-[10px] font-semibold text-muted-foreground">{eligibility.explanation}</p>
      ) : null}
      {error ? <p className="text-[10px] font-bold text-rose-700">{error}</p> : null}
      {open ? (
        <RemoteSupportRequestDialog
          lang={lang}
          shopName={shopName}
          deviceLabel={deviceLabel}
          technicianName={technicianName}
          busy={busy}
          onCancel={() => setOpen(false)}
          onSubmit={(code, text) => void submit(code, text)}
        />
      ) : null}
    </div>
  );
}
