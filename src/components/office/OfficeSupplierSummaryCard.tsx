import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Truck } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { buildSupplierSummary } from "../../lib/purchaseReporting";

export function OfficeSupplierSummaryCard({ lang }: { lang: Language }) {
  const suppliers = usePosStore((s) => s.suppliers);
  const summary = useMemo(() => buildSupplierSummary(suppliers), [suppliers]);

  if (summary.totalSuppliers === 0) return null;

  return (
    <section className="rounded-3xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-card p-5 shadow-waka-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-amber-800">{t(lang, "officeSupplierSummaryTitle")}</p>
          <p className="mt-1 text-2xl font-black text-amber-950">UGX {summary.totalDebtUgx.toLocaleString()}</p>
          <p className="mt-1 text-xs font-semibold text-amber-900/80">{t(lang, "officeSupplierSummaryDebt")}</p>
        </div>
        <Truck className="h-8 w-8 text-amber-700/60" aria-hidden />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-card px-3 py-2 ring-1 ring-amber-100">
          <dt className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "officeSupplierSummaryTotal")}</dt>
          <dd className="mt-0.5 text-lg font-black text-foreground">{summary.totalSuppliers}</dd>
        </div>
        <div className="rounded-2xl bg-card px-3 py-2 ring-1 ring-amber-100">
          <dt className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "officeSupplierSummaryWithBalance")}</dt>
          <dd className="mt-0.5 text-lg font-black text-foreground">{summary.suppliersWithBalance}</dd>
        </div>
        {summary.largestBalanceUgx > 0 ? (
          <div className="col-span-2 rounded-2xl bg-card px-3 py-2 ring-1 ring-amber-100">
            <dt className="text-[10px] font-black uppercase text-muted-foreground">{t(lang, "officeSupplierSummaryLargest")}</dt>
            <dd className="mt-0.5 font-bold text-foreground">
              {summary.largestBalanceSupplierName} · UGX {summary.largestBalanceUgx.toLocaleString()}
            </dd>
          </div>
        ) : null}
      </dl>
      <Link
        to="/office/purchases"
        className="mt-4 inline-flex min-h-[44px] items-center rounded-2xl bg-amber-700 px-4 py-2 text-sm font-black text-white"
      >
        {t(lang, "officeCardPurchases")}
      </Link>
    </section>
  );
}
