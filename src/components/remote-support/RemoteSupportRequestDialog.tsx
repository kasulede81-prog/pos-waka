import { useState } from "react";
import { WakaSymbolIcon } from "../brand/WakaLogo";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  REMOTE_SUPPORT_REASON_CODES,
  type RemoteSupportReasonCode,
} from "../../lib/remoteSupport";

type Props = {
  lang: Language;
  shopName: string;
  deviceLabel: string;
  technicianName: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (reasonCode: RemoteSupportReasonCode, reasonText: string) => void;
};

export function RemoteSupportRequestDialog({
  lang,
  shopName,
  deviceLabel,
  technicianName,
  busy,
  onCancel,
  onSubmit,
}: Props) {
  const [reasonCode, setReasonCode] = useState<RemoteSupportReasonCode>("other");
  const [reasonText, setReasonText] = useState("");
  const trimmed = reasonText.trim();
  const canSend = trimmed.length >= 3 && !busy;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <WakaSymbolIcon className="h-7 w-7" />
          <h2 className="text-lg font-black text-foreground">{t(lang, "remoteSupportTitle")}</h2>
        </div>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "remoteSupportDevice")}</dt>
            <dd className="font-semibold text-foreground">
              {shopName} — {deviceLabel}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "remoteSupportTechnician")}</dt>
            <dd className="font-semibold text-foreground">{technicianName}</dd>
          </div>
        </dl>
        <label className="mt-4 block text-xs font-bold text-muted-foreground">
          {t(lang, "remoteSupportReasonLabel")}
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as RemoteSupportReasonCode)}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-border px-3 text-sm font-semibold text-foreground"
          >
            {REMOTE_SUPPORT_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {t(lang, `remoteSupportReason_${code}`)}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={3}
          required
          placeholder={t(lang, "remoteSupportReasonPlaceholder")}
          className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm font-semibold text-foreground"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] rounded-xl border border-border px-4 text-sm font-black"
          >
            {t(lang, "remoteSupportCancel")}
          </button>
          <button
            type="button"
            disabled={!canSend}
            onClick={() => onSubmit(reasonCode, trimmed)}
            className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-40"
          >
            {t(lang, "remoteSupportSendRequest")}
          </button>
        </div>
      </div>
    </div>
  );
}
