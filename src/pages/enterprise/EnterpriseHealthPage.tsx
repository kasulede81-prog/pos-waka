import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { ENTERPRISE_PERFORMANCE_BUDGETS } from "../../types/enterprise";

export function EnterpriseHealthPage({ lang }: { lang: Language }) {
  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_health")} subtitle={t(lang, "enterpriseHealthSub")}>
      <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
        {t(lang, "enterpriseHealthReferenceNote")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <BudgetCard label={t(lang, "enterpriseHealth_products")} value={ENTERPRISE_PERFORMANCE_BUDGETS.maxProductsPerBranch.toLocaleString()} />
        <BudgetCard label={t(lang, "enterpriseHealth_sales")} value={ENTERPRISE_PERFORMANCE_BUDGETS.maxSalesPerBranch.toLocaleString()} />
        <BudgetCard label={t(lang, "enterpriseHealth_staff")} value={String(ENTERPRISE_PERFORMANCE_BUDGETS.maxStaffPerOrg)} />
        <BudgetCard label={t(lang, "enterpriseHealth_devices")} value={String(ENTERPRISE_PERFORMANCE_BUDGETS.maxDevicesPerOrg)} />
        <BudgetCard label={t(lang, "enterpriseHealth_queryMs")} value={String(ENTERPRISE_PERFORMANCE_BUDGETS.dashboardQueryMs)} />
      </div>
    </EnterpriseShell>
  );
}

function BudgetCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black text-foreground">{value}</p>
    </div>
  );
}
