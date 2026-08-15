import { WakaSymbolIcon } from "../brand/WakaLogo";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { RemoteSupportRequest } from "../../lib/remoteSupport";

type Props = {
  lang: Language;
  request?: RemoteSupportRequest | null;
  busy?: boolean;
  approved?: boolean;
  onDecline: () => void;
  onAllow: () => void;
};

export function RemoteSupportApprovalDialog({ lang, request, busy, approved, onDecline, onAllow }: Props) {
  const technician = request?.technician_name?.trim() || "WAKA Support";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <WakaSymbolIcon className="h-7 w-7" />
          <h2 className="text-lg font-black text-foreground">{t(lang, "remoteSupportTitle")}</h2>
        </div>
        {approved ? (
          <div className="space-y-2">
            <p className="text-base font-black text-foreground">{t(lang, "remoteSupportApprovedTitle")}</p>
            <p className="text-sm font-semibold text-muted-foreground">{t(lang, "remoteSupportApprovedBody")}</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-foreground">{t(lang, "remoteSupportApprovalLead")}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "remoteSupportTechnician")}</dt>
                <dd className="font-black text-foreground">{technician} — WAKA Support</dd>
              </div>
              <div>
                <dt className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "remoteSupportReasonLabel")}</dt>
                <dd className="font-semibold text-foreground">{request?.reason_text}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm font-bold text-rose-800">{t(lang, "remoteSupportApprovalWarn")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onDecline}
                className="min-h-[44px] rounded-xl border border-border px-4 text-sm font-black disabled:opacity-40"
              >
                {t(lang, "remoteSupportDecline")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onAllow}
                className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-40"
              >
                {t(lang, "remoteSupportAllow")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
