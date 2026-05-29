import { useMemo, useState } from "react";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { Navigate } from "react-router-dom";
import { CalendarDays, ChevronDown, FileDown, Printer } from "lucide-react";
import type { Language, Sale, SaleLine } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala, saleMatchesReceiptRange, type ReceiptDateRange } from "../lib/datesUg";
import { buildReceiptNumberForSale, buildSaleReceiptText, printReceiptText } from "../lib/receiptPrint";
import { VoidLineModal } from "../components/pos/VoidLineModal";
import { ReturnProductModal } from "../components/pos/ReturnProductModal";
import type { VoidReason } from "../types";

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

const RECEIPT_FILTERS: { key: ReceiptDateRange; labelKey: "receiptsFilterToday" | "receiptsFilterWeek" | "receiptsFilterMonth" }[] = [
  { key: "today", labelKey: "receiptsFilterToday" },
  { key: "week", labelKey: "receiptsFilterWeek" },
  { key: "month", labelKey: "receiptsFilterMonth" },
];

export function ReceiptsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const [includeArchived, setIncludeArchived] = useState(false);
  const sales = useDeferredReportingSales(includeArchived);
  const products = usePosStore((s) => s.products);
  const voidSaleLine = usePosStore((s) => s.voidSaleLine);
  const returnProduct = usePosStore((s) => s.returnProduct);
  const preferences = usePosStore((s) => s.preferences);
  const [range, setRange] = useState<ReceiptDateRange>("today");
  const [voidTarget, setVoidTarget] = useState<{ sale: Sale; lineIndex: number; line: SaleLine } | null>(null);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);

  const shopLabel = preferences.shopDisplayName?.trim() || undefined;
  const customers = usePosStore((s) => s.customers);
  const staffAccounts = preferences.staffAccounts ?? [];

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staffAccounts) {
      map.set(s.id, s.name);
    }
    return map;
  }, [staffAccounts]);

  const printSale = (sale: Sale) => {
    const shopName = shopLabel || "Waka POS";
    const cashier = soldByLabel(sale);
    const receiptNumber = buildReceiptNumberForSale(sale, sales);
    const cust = sale.customerId ? customers.find((c) => c.id === sale.customerId) : null;
    const productById = new Map(products.map((p) => [p.id, p] as const));
    const text = buildSaleReceiptText({
      shopName,
      shopAddress: preferences.shopAddressLine ?? null,
      shopPhone: preferences.shopPhoneE164 ?? null,
      cashier,
      receiptNumber,
      sale,
      productById,
      customerName: cust?.name ?? null,
      customerBalanceUgx: cust ? cust.debtBalanceUgx : null,
      labels: {
        cashier: t(lang, "receiptCashier"),
        items: t(lang, "receiptItemsLabel"),
        total: t(lang, "receiptTotalLabel"),
        paid: t(lang, "receiptPaidLabel"),
        debtSale: t(lang, "receiptDebtLine"),
        balance: t(lang, "receiptBalanceLine"),
        time: t(lang, "receiptTimeLabel"),
      },
    });
    const ok = printReceiptText(text, preferences.receiptPaperSize ?? "80mm");
    if (!ok) window.alert(t(lang, "receiptPrintBlocked"));
  };

  const filteredSales = useMemo(() => {
    const inRange = sales.filter((s) => saleMatchesReceiptRange(s.createdAt, range));
    if (actor.role !== "cashier") return inRange;
    return inRange.filter((s) => s.soldByUserId && s.soldByUserId === actor.userId);
  }, [sales, range, actor.role, actor.userId]);

  const byDay = useMemo(() => groupSalesByKampalaDay(filteredSales), [filteredSales]);

  const soldByLabel = (sale: Sale): string => {
    const id = sale.soldByUserId ?? "";
    if (!id) return t(lang, "role_owner");
    if (id.startsWith("staff:")) {
      const staffId = id.slice("staff:".length);
      return staffNameById.get(staffId) ?? t(lang, "role_cashier");
    }
    return t(lang, "role_owner");
  };

  if (!hasPermission(actor.role, "receipts.view")) {
    return <Navigate to="/" replace />;
  }

  const onDownloadAll = async () => {
    const { saveSalesListPdf } = await import("../lib/receiptsPdf");
    saveSalesListPdf({
      sales: filteredSales,
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
    <div className="space-y-3 pb-8 md:pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-black tracking-tight text-slate-950">{t(lang, "receipts")}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">{t(lang, "receiptsHint")}</p>
        </div>
        {filteredSales.length > 0 ? (
          <button
            type="button"
            onClick={onDownloadAll}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-waka-200 bg-white px-3 text-xs font-black text-waka-800 shadow-sm transition-waka active:bg-waka-50"
          >
            <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(lang, "receiptsDownloadPdf")}
          </button>
        ) : null}
      </div>

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      {sales.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {RECEIPT_FILTERS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-xs font-black transition-colors active:scale-[0.98] ${
                range === key
                  ? "border-waka-400 bg-waka-600 text-white shadow-sm"
                  : "border-stone-200 bg-white text-stone-700 hover:border-waka-200 hover:bg-waka-50"
              }`}
            >
              {t(lang, labelKey)}
            </button>
          ))}
        </div>
      ) : null}

      {sales.length > 0 && filteredSales.length === 0 ? (
        <p className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm font-bold text-stone-600">
          {t(lang, "receiptsNoSalesInRange")}
        </p>
      ) : null}

      {sales.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-200 bg-white px-6 py-12 text-center">
          <CalendarDays className="mx-auto h-7 w-7 text-stone-300" />
          <p className="mt-2 text-sm font-bold text-slate-500">{t(lang, "noSalesYet")}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {byDay.map((group) => (
          <details
            key={group.dateKey}
            className="group overflow-hidden rounded-[1.35rem] border border-stone-200/90 bg-white shadow-waka-sm open:ring-1 open:ring-waka-100"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 marker:content-none [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-black text-stone-950">{formatReceiptsDayHeading(group.dateKey)}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-500">
                  {tTemplate(lang, "receiptsDayGroupMeta", {
                    count: group.sales.length,
                    amount: group.dayTotalUgx.toLocaleString(),
                  })}
                </p>
              </div>
            </summary>
            <div className="space-y-2 border-t border-stone-100 bg-stone-50/50 px-3 py-3 sm:px-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onDownloadDay(group.sales, group.dateKey)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-black text-waka-700 ring-1 ring-stone-200"
                >
                  <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t(lang, "receiptsDownloadDayPdf")}
                </button>
              </div>
              {group.sales.map((sale) => (
                <article key={sale.id} className="rounded-2xl border border-stone-100 bg-white p-3">
                  <div className="flex justify-between gap-2">
                    <p className="font-mono text-xs font-bold text-slate-500">#{sale.id.slice(0, 8)}</p>
                    <p className="text-xs font-medium text-slate-500">{new Date(sale.createdAt).toLocaleString()}</p>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {t(lang, "receiptCashier")}: {soldByLabel(sale)}
                  </p>
                  <p className="mt-1 text-lg font-black text-slate-950">UGX {sale.totalUgx.toLocaleString()}</p>
                  <p className="text-xs font-medium text-slate-500">
                    {t(lang, "cashLabel")}: UGX {sale.cashPaidUgx.toLocaleString()}
                    {sale.debtUgx > 0 ? (
                      <>
                        {" · "}
                        {t(lang, "creditLabel")}: UGX {sale.debtUgx.toLocaleString()}
                      </>
                    ) : null}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    {sale.lines.map((line, lineIndex) => (
                      <li key={`${sale.id}-${line.productId}-${lineIndex}`} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          {line.voided ? (
                            <span className="font-bold text-rose-700 line-through">{line.name}</span>
                          ) : (
                            line.name
                          )}{" "}
                          <span className="text-xs text-slate-500">
                            ({line.inputMode === "money" ? t(lang, "byMoney") : t(lang, "byQuantity")})
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={line.voided ? "line-through text-slate-400" : ""}>
                            UGX {line.lineTotalUgx.toLocaleString()}
                          </span>
                          {!line.voided && hasPermission(actor.role, "pos.sell") ? (
                            <button
                              type="button"
                              onClick={() => setVoidTarget({ sale, lineIndex, line })}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black uppercase text-rose-800"
                            >
                              {t(lang, "voidBtn")}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => printSale(sale)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-stone-800"
                    >
                      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t(lang, "receiptPrint")}
                    </button>
                    {hasPermission(actor.role, "pos.sell") ? (
                      <button
                        type="button"
                        onClick={() => setReturnSale(sale)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-950"
                      >
                        {t(lang, "returnBtn")}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </details>
        ))}
      </div>

      <VoidLineModal
        lang={lang}
        open={voidTarget !== null}
        line={voidTarget?.line ?? null}
        onClose={() => setVoidTarget(null)}
        onConfirm={(reason: VoidReason, note) => {
          if (!voidTarget) return;
          voidSaleLine({
            saleId: voidTarget.sale.id,
            lineIndex: voidTarget.lineIndex,
            reason,
            note,
          });
          setVoidTarget(null);
        }}
      />

      <ReturnProductModal
        lang={lang}
        open={returnSale !== null}
        sale={returnSale}
        products={products}
        onClose={() => setReturnSale(null)}
        onConfirm={(input) => returnProduct(input)}
      />
    </div>
  );
}
