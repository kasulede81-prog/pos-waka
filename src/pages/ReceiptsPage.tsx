import { useEffect, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { ChevronDown, FileDown } from "lucide-react";
import type { Language, Sale } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala } from "../lib/datesUg";

function formatReceiptsDayHeading(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return dateKey;
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-UG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  }).format(anchor);
}

function groupSalesByKampalaDay(sales: Sale[]): { dateKey: string; sales: Sale[]; dayTotalUgx: number }[] {
  const map = new Map<string, Sale[]>();
  for (const sale of sales) {
    const key = dateKeyKampala(sale.createdAt);
    const arr = map.get(key);
    if (arr) arr.push(sale);
    else map.set(key, [sale]);
  }
  const keys = [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return keys.map((dateKey) => {
    const daySales = map.get(dateKey) ?? [];
    const dayTotalUgx = daySales.reduce((acc, s) => acc + s.totalUgx, 0);
    return { dateKey, sales: daySales, dayTotalUgx };
  });
}

export function ReceiptsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const sales = usePosStore((s) => s.sales);
  const preferences = usePosStore((s) => s.preferences);
  const pruneExpiredSales = usePosStore((s) => s.pruneExpiredSales);

  useEffect(() => {
    pruneExpiredSales();
  }, [pruneExpiredSales]);

  const shopLabel = preferences.shopDisplayName?.trim() || undefined;

  const byDay = useMemo(() => groupSalesByKampalaDay(sales), [sales]);

  if (!hasPermission(actor.role, "receipts.view")) {
    return <Navigate to="/" replace />;
  }

  const onDownloadAll = async () => {
    const { saveSalesListPdf } = await import("../lib/receiptsPdf");
    saveSalesListPdf({
      sales,
      title: t(lang, "receiptsPdfAllTitle"),
      subtitle: shopLabel,
      fileStem: `waka-past-sales-all-${dateKeyKampala(new Date())}`,
    });
  };

  const onDownloadDay = async (daySales: Sale[], dateKey: string) => {
    const { saveSalesListPdf } = await import("../lib/receiptsPdf");
    saveSalesListPdf({
      sales: daySales,
      title: tTemplate(lang, "receiptsPdfDayTitle", { date: formatReceiptsDayHeading(dateKey) }),
      subtitle: shopLabel,
      fileStem: `waka-past-sales-${dateKey}`,
    });
  };

  return (
    <div className="space-y-4 pb-8 md:pb-4">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t(lang, "receipts")}</h2>
        <p className="text-sm text-slate-600">{t(lang, "receiptsHint")}</p>
        <p className="text-xs leading-relaxed text-slate-500">{t(lang, "receiptsRetentionNotice")}</p>
      </div>

      {sales.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{t(lang, "receiptsGroupedLabel")}</p>
          <button
            type="button"
            onClick={onDownloadAll}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-waka-200 bg-waka-50 px-4 py-2.5 text-sm font-bold text-waka-900 shadow-sm transition-waka hover:bg-waka-100 active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <FileDown className="h-4 w-4 shrink-0" aria-hidden />
            {t(lang, "receiptsDownloadPdf")}
          </button>
        </div>
      ) : null}

      {sales.length === 0 ? <p className="text-sm text-slate-500">{t(lang, "noSalesYet")}</p> : null}

      <div className="space-y-2">
        {byDay.map((group) => (
          <details
            key={group.dateKey}
            className="group overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-waka-sm open:ring-1 open:ring-waka-100"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-5 w-5 shrink-0 text-stone-400 transition-transform group-open:rotate-180" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-stone-900">{formatReceiptsDayHeading(group.dateKey)}</p>
                <p className="text-xs text-slate-600">
                  {tTemplate(lang, "receiptsDayGroupMeta", {
                    count: group.sales.length,
                    amount: group.dayTotalUgx.toLocaleString(),
                  })}
                </p>
              </div>
            </summary>
            <div className="space-y-3 border-t border-stone-100 px-3 py-3 sm:px-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onDownloadDay(group.sales, group.dateKey)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-waka-700 underline-offset-2 hover:underline"
                >
                  <FileDown className="h-4 w-4 shrink-0" aria-hidden />
                  {t(lang, "receiptsDownloadDayPdf")}
                </button>
              </div>
              {group.sales.map((sale) => (
                <article key={sale.id} className="rounded-2xl border border-stone-100 bg-stone-50/60 p-4">
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
                      <li key={`${sale.id}-${line.productId}`} className="flex justify-between gap-2">
                        <span className="min-w-0">
                          {line.name}{" "}
                          <span className="text-xs text-slate-500">
                            ({line.inputMode === "money" ? t(lang, "byMoney") : t(lang, "byQuantity")})
                          </span>
                        </span>
                        <span className="shrink-0">UGX {line.lineTotalUgx.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
