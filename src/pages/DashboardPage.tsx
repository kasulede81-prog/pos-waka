import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

export function DashboardPage({ lang }: { lang: Language }) {
  const { sales, items } = usePosStore();
  const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
  const lowStock = items.filter((item) => item.stock <= item.lowStockThreshold).length;

  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <h2 className="text-xl font-semibold">{t(lang, "dashboard")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <article className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">{t(lang, "totalSales")}</p>
          <p className="mt-2 text-2xl font-bold">UGX {totalSales.toLocaleString()}</p>
        </article>
        <article className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">{t(lang, "itemsInStock")}</p>
          <p className="mt-2 text-2xl font-bold">{items.length}</p>
        </article>
        <article className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">{t(lang, "lowStock")}</p>
          <p className="mt-2 text-2xl font-bold">{lowStock}</p>
        </article>
      </div>
    </div>
  );
}
