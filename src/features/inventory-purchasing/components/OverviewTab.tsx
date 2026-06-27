import clsx from "clsx";
import {
  AlertTriangle,
  CreditCard,
  Package,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { OverviewStats, MonthlyPurchasePoint, SupplierSpendRow } from "../lib/overviewStats";
import { formatShortUgx } from "../lib/overviewStats";

type Props = {
  lang: Language;
  stats: OverviewStats;
  monthlyTrend: MonthlyPurchasePoint[];
  topSuppliers: SupplierSpendRow[];
  onNewPurchase: () => void;
  onAddSupplier: () => void;
  onReceiveStock: () => void;
  onViewPurchases: () => void;
  onViewLowStock: () => void;
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  warn,
  highlight,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex min-h-[88px] flex-col justify-between rounded-2xl border p-3 shadow-sm",
        highlight ? "border-waka-200 bg-gradient-to-br from-waka-50 to-orange-50/60" : "border-stone-200/90 bg-white",
        warn && !highlight && "border-rose-100 bg-rose-50/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={clsx("flex h-8 w-8 items-center justify-center rounded-xl", highlight ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-600")}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</span>
      </div>
      <div>
        <p className={clsx("text-lg font-black tabular-nums", warn ? "text-rose-800" : highlight ? "text-waka-800" : "text-stone-950")}>{value}</p>
        {hint ? <p className="text-[10px] font-semibold text-stone-500">{hint}</p> : null}
      </div>
    </div>
  );
}

function TrendChart({ lang, points }: { lang: Language; points: MonthlyPurchasePoint[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.totalUgx);
  const max = Math.max(...values, 1);
  const w = 280;
  const h = 80;
  const pad = 8;
  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = h - pad - (p.totalUgx / max) * (h - pad * 2);
    return { x, y, ...p };
  });
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <h3 className="text-xs font-black text-stone-800">{t(lang, "ipChartMonthlyTrend")}</h3>
      <svg viewBox={`0 0 ${w} ${h + 20}`} className="mt-2 h-auto w-full" aria-hidden>
        <polyline points={line} fill="none" stroke="rgb(245 90 0)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c) => (
          <text key={c.monthKey} x={c.x} y={h + 14} textAnchor="middle" className="fill-stone-500 text-[9px] font-bold">
            {c.label}
          </text>
        ))}
      </svg>
    </section>
  );
}

export function OverviewTab({
  lang,
  stats,
  monthlyTrend,
  topSuppliers,
  onNewPurchase,
  onAddSupplier,
  onReceiveStock,
  onViewPurchases,
  onViewLowStock,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard icon={ShoppingCart} label={t(lang, "ipStatTotalPurchased")} value={formatShortUgx(stats.totalPurchasedUgx)} highlight />
        <StatCard icon={CreditCard} label={t(lang, "ipStatTotalPaid")} value={formatShortUgx(stats.totalPaidUgx)} />
        <StatCard icon={AlertTriangle} label={t(lang, "ipStatOutstanding")} value={formatShortUgx(stats.outstandingUgx)} warn={stats.outstandingUgx > 0} hint={t(lang, "ipStatOutstandingHint")} />
        <StatCard icon={Users} label={t(lang, "ipStatActiveSuppliers")} value={String(stats.activeSuppliers)} />
        <StatCard icon={Receipt} label={t(lang, "ipStatOpenOrders")} value={String(stats.openPurchaseOrders)} />
        <StatCard icon={Package} label={t(lang, "ipStatLowStock")} value={String(stats.lowStockCount)} warn={stats.lowStockCount > 0} hint={t(lang, "ipStatLowStockHint")} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TrendChart lang={lang} points={monthlyTrend} />
        <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-black text-stone-800">{t(lang, "ipChartSupplierSpend")}</h3>
          {topSuppliers.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-stone-500">{t(lang, "ipNoSupplierSpend")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {topSuppliers.map((row) => (
                <li key={row.supplierId} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-stone-800">{row.name}</span>
                  <span className="shrink-0 text-xs font-black tabular-nums text-waka-700">{row.pct}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
        <h3 className="text-xs font-black text-stone-800">{t(lang, "ipChartPaidVsOwed")}</h3>
        <div className="mt-3 flex items-center gap-4">
          <div className="relative h-20 w-20">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e7e5e4" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15.9"
                fill="none"
                stroke="#10b981"
                strokeWidth="3"
                strokeDasharray={`${stats.paidPct} ${100 - stats.paidPct}`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-emerald-800">{stats.paidPct}%</span>
          </div>
          <div className="text-sm font-semibold text-stone-600">
            <p>{t(lang, "ipPaidLabel")}: {formatShortUgx(stats.totalPaidUgx)}</p>
            <p className="mt-1 text-rose-700">{t(lang, "ipOwedLabel")}: {formatShortUgx(stats.outstandingUgx)}</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "ipQuickActions")}</h3>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={onNewPurchase} className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl bg-waka-600 px-2 text-center text-[11px] font-black text-white shadow-sm">
            <Truck className="h-5 w-5" aria-hidden />
            {t(lang, "ipActionNewPurchase")}
          </button>
          <button type="button" onClick={onAddSupplier} className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border border-stone-200 bg-white px-2 text-center text-[11px] font-black text-stone-800 shadow-sm">
            <Users className="h-5 w-5" aria-hidden />
            {t(lang, "ipActionAddSupplier")}
          </button>
          <button type="button" onClick={onReceiveStock} className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border border-stone-200 bg-white px-2 text-center text-[11px] font-black text-stone-800 shadow-sm">
            <Package className="h-5 w-5" aria-hidden />
            {t(lang, "ipActionReceiveStock")}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onViewPurchases} className="text-xs font-black text-waka-700 underline-offset-2 hover:underline">
            {t(lang, "ipViewAllPurchases")} →
          </button>
          {stats.lowStockCount > 0 ? (
            <button type="button" onClick={onViewLowStock} className="text-xs font-black text-rose-700 underline-offset-2 hover:underline">
              {t(lang, "ipViewLowStock")} →
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
