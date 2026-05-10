import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";

export function ReceiptsPage({ lang }: { lang: Language }) {
  const { sales } = usePosStore();
  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <h2 className="text-xl font-semibold">{t(lang, "receipts")}</h2>
      {sales.length === 0 && <p className="text-sm text-slate-500">No receipts yet.</p>}
      {sales.map((sale) => (
        <article key={sale.id} className="rounded-xl border bg-white p-4">
          <div className="flex justify-between">
            <p className="font-medium">Receipt #{sale.id.slice(0, 8)}</p>
            <p className="text-sm">{new Date(sale.createdAt).toLocaleString()}</p>
          </div>
          <p className="mt-2 text-lg font-semibold">UGX {sale.total.toLocaleString()}</p>
          <p className="text-xs text-slate-500">{sale.paymentMethod}</p>
        </article>
      ))}
    </div>
  );
}
