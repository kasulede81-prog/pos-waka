import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";

export function EnterprisePurchasingPage({ lang }: { lang: Language }) {
  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_purchasing")} subtitle={t(lang, "enterprisePurchasingSub")}>
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <ul className="space-y-2 text-sm font-semibold text-stone-700">
          {(["pending", "approved", "ordered", "partially_received", "received", "cancelled"] as const).map((s) => (
            <li key={s}>{t(lang, `enterprisePoStatus_${s}` as never)}</li>
          ))}
        </ul>
      </div>
    </EnterpriseShell>
  );
}
