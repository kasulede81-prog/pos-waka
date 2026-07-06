import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { nextTransferStatuses } from "../../lib/enterprise/stockTransfer";

export function EnterpriseTransfersPage({ lang }: { lang: Language }) {
  const lifecycle = nextTransferStatuses("draft");

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_transfers")} subtitle={t(lang, "enterpriseTransfersSub")}>
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-stone-700">{t(lang, "enterpriseTransfersLifecycle")}</p>
        <ol className="mt-4 flex flex-wrap gap-2">
          {["draft", "pending_approval", "approved", "shipped", "in_transit", "received", "completed"].map((s) => (
            <li key={s} className="rounded-lg bg-stone-100 px-3 py-1 text-xs font-black uppercase text-stone-700">
              {t(lang, `enterpriseTransferStatus_${s}` as never)}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm font-medium text-stone-500">
          {t(lang, "enterpriseTransfersNext")}: {lifecycle.map((s) => t(lang, `enterpriseTransferStatus_${s}` as never)).join(", ")}
        </p>
      </div>
    </EnterpriseShell>
  );
}
