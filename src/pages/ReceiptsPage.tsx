import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

export function ReceiptsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const sales = usePosStore((s) => s.sales);

  if (!hasPermission(actor.role, "receipts.view")) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-4 pb-8 md:pb-4">
      <h2 className="text-xl font-semibold">{t(lang, "receipts")}</h2>
      <p className="text-sm text-slate-600">{t(lang, "receiptsHint")}</p>
      {sales.length === 0 && <p className="text-sm text-slate-500">{t(lang, "noSalesYet")}</p>}
      {sales.map((sale) => (
        <article key={sale.id} className="rounded-2xl border bg-white p-4">
          <div className="flex justify-between gap-2">
            <p className="font-medium">#{sale.id.slice(0, 8)}</p>
            <p className="text-sm text-slate-500">{new Date(sale.createdAt).toLocaleString()}</p>
          </div>
          <p className="mt-2 text-lg font-semibold">UGX {sale.totalUgx.toLocaleString()}</p>
          <p className="text-xs text-slate-500">
            {t(lang, "cashLabel")}: UGX {sale.cashPaidUgx.toLocaleString()}
            {sale.debtUgx > 0 ? (
              <>
                {" · "}
                {t(lang, "creditLabel")}: UGX {sale.debtUgx.toLocaleString()}
              </>
            ) : null}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {sale.lines.map((line) => (
              <li key={`${sale.id}-${line.productId}`} className="flex justify-between">
                <span>
                  {line.name}{" "}
                  <span className="text-xs text-slate-500">
                    ({line.inputMode === "money" ? t(lang, "byMoney") : t(lang, "byQuantity")})
                  </span>
                </span>
                <span>UGX {line.lineTotalUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
