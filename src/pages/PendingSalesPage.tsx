import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Language, Sale } from "../types";
import { t } from "../lib/i18n";
import { formatUgx } from "../lib/formatUgx";
import { pendingSales } from "../lib/saleStatus";
import { usePosStore } from "../store/usePosStore";
import { PageBackBar } from "../components/layout/PageBackBar";
import { hasPermission } from "../lib/permissions";
import { useSessionActor } from "../context/SessionActorContext";
import { useProtectedAction } from "../hooks/useProtectedAction";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function PendingSalesPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const { runProtected } = useProtectedAction();
  const sales = usePosStore((s) => s.sales);
  const resumePendingSale = usePosStore((s) => s.resumePendingSale);
  const cancelPendingSale = usePosStore((s) => s.cancelPendingSale);
  const floor = usePosStore((s) => s.preferences.hospitalityFloor);

  const rows = useMemo(() => pendingSales(sales).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)), [sales]);

  const resume = (sale: Sale) => {
    const res = resumePendingSale(sale.id);
    if (!res.ok) return;
    if (sale.tableSessionId) {
      navigate(`/floor/order/${sale.tableSessionId}`);
      return;
    }
    navigate("/pos");
  };

  const canCancel = hasPermission(actor.role, "pending_sales.manage");

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar lang={lang} fallbackTo="/" label={t(lang, "navHome")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "pendingSalesTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "pendingSalesSub")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-500">
          {t(lang, "pendingSalesEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((sale) => {
            const session = sale.tableSessionId
              ? floor?.sessions.find((s) => s.id === sale.tableSessionId)
              : undefined;
            const table = session ? floor?.tables.find((t) => t.id === session.tableId) : undefined;
            const label = sale.referenceLabel || table?.label || t(lang, "pendingSalesWaiting");
            return (
              <li key={sale.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-stone-950">{label}</p>
                    <p className="text-sm font-bold text-waka-700">{formatUgx(sale.totalUgx)}</p>
                    <p className="text-xs font-medium text-slate-500">
                      {sale.lines.length} {t(lang, "pendingSalesItems")} · {formatWhen(sale.updatedAt ?? sale.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => resume(sale)}
                      className="min-h-10 rounded-xl bg-waka-600 px-4 text-xs font-black text-white"
                    >
                      {t(lang, "pendingSalesResume")}
                    </button>
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runProtected("delete_transaction", () => {
                            cancelPendingSale(sale.id);
                          })
                        }
                        className="min-h-10 rounded-xl border border-rose-200 px-4 text-xs font-black text-rose-800"
                      >
                        {t(lang, "pendingSalesCancel")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
