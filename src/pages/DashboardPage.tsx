import { useMemo } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "../lib/datesUg";
import { isLowStock } from "../lib/sellingEngine";
import { Link } from "react-router-dom";
import { BusinessTypeOnboarding } from "../components/BusinessTypeOnboarding";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { buildGroupedActivityTimeline } from "../lib/activityNarrative";

export function DashboardPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canProfit = hasPermission(actor.role, "reports.profit");
  const sales = usePosStore((s) => s.sales);
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const customers = usePosStore((s) => s.customers);
  const showActivityFeed = hasPermission(actor.role, "owner.activity");

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const activityGroups = useMemo(
    () => buildGroupedActivityTimeline(lang, auditLogs, productById, customerById, { maxGroups: 8 }),
    [lang, auditLogs, productById, customerById],
  );

  const todayKey = dateKeyKampala(new Date());

  const todaySales = useMemo(
    () => sales.filter((s) => dateKeyKampala(s.createdAt) === todayKey),
    [sales, todayKey],
  );

  const cashToday = useMemo(() => todaySales.reduce((a, s) => a + s.cashPaidUgx, 0), [todaySales]);
  const profitToday = useMemo(() => todaySales.reduce((a, s) => a + s.estimatedProfitUgx, 0), [todaySales]);
  const debtToday = useMemo(() => todaySales.reduce((a, s) => a + s.debtUgx, 0), [todaySales]);
  const lowStockProducts = useMemo(() => products.filter((p) => isLowStock(p)), [products]);

  const fastMovers = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
    for (const sale of todaySales) {
      for (const line of sale.lines) {
        const cur = map.get(line.productId) ?? { name: line.name, qty: 0, revenue: 0, profit: 0 };
        const p = products.find((x) => x.id === line.productId);
        const lineProfit = p ? line.lineTotalUgx - line.quantity * p.costPricePerUnitUgx : 0;
        map.set(line.productId, {
          name: line.name,
          qty: cur.qty + line.quantity,
          revenue: cur.revenue + line.lineTotalUgx,
          profit: cur.profit + lineProfit,
        });
      }
    }
    return [...map.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [todaySales, products]);

  const recentSales = useMemo(() => todaySales.slice(0, 6), [todaySales]);

  const weekCut = dateKeyDaysAgoKampala(6);
  const weekSales = useMemo(
    () => sales.filter((s) => dateKeyKampala(s.createdAt) >= weekCut),
    [sales, weekCut],
  );
  const cashWeek = weekSales.reduce((a, s) => a + s.cashPaidUgx, 0);

  return (
    <div className="space-y-6 pb-8">
      {!preferences.onboardingDone ? <BusinessTypeOnboarding lang={lang} /> : null}

      {preferences.onboardingDone && (products.length === 0 || sales.length === 0) ? (
        <section className="rounded-3xl border-2 border-emerald-200 bg-emerald-50/90 p-6 shadow-sm">
          <h2 className="text-xl font-black text-emerald-950">{t(lang, "setupChecklistTitle")}</h2>
          <p className="mt-1 text-base text-emerald-900">{t(lang, "setupChecklistSub")}</p>
          <ol className="mt-4 space-y-3 text-lg">
            <li className="flex flex-wrap items-center gap-2 font-bold text-slate-900">
              <span className={products.length > 0 ? "text-emerald-600" : "text-slate-400"}>{products.length > 0 ? "✓" : "①"}</span>
              {t(lang, "setupStep1")}
              {products.length === 0 ? (
                <Link to="/stock" className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "stockTitle")}
                </Link>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-bold text-slate-900">
              <span className={sales.length > 0 ? "text-emerald-600" : "text-slate-400"}>{sales.length > 0 ? "✓" : "②"}</span>
              {t(lang, "setupStep2")}
              {sales.length === 0 ? (
                <Link to="/pos" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white">
                  {t(lang, "sellTitle")}
                </Link>
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2 font-bold text-slate-900">
              <span className="text-slate-400">③</span>
              {t(lang, "setupStep3")}
              {hasPermission(actor.role, "reports.view") ? (
                <Link to="/reports" className="rounded-full border-2 border-emerald-700 px-4 py-2 text-sm font-black text-emerald-900">
                  {t(lang, "reports")}
                </Link>
              ) : null}
            </li>
          </ol>
        </section>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900">{t(lang, "homeHello")}</h1>
          <p className="mt-1 text-lg text-slate-600">{t(lang, "homeSub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/pos"
            className="rounded-2xl bg-emerald-600 px-5 py-3 text-lg font-black text-white shadow-md active:bg-emerald-700"
          >
            {t(lang, "sellTitle")}
          </Link>
          <Link
            to="/stock"
            className="rounded-2xl border-2 border-slate-200 bg-white px-5 py-3 text-lg font-bold text-slate-800"
          >
            {t(lang, "stockTitle")}
          </Link>
          <Link
            to="/close-day"
            className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-5 py-3 text-lg font-bold text-amber-950"
          >
            {t(lang, "closeDay")}
          </Link>
        </div>
      </div>

      {showActivityFeed && activityGroups.length > 0 ? (
        <section className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-black text-slate-900">{t(lang, "activityFeedTitle")}</h2>
            <Link to="/owner/activity" className="text-sm font-bold text-emerald-700">
              {t(lang, "seeAll")}
            </Link>
          </div>
          <ul className="mt-3 space-y-3">
            {activityGroups.map((g) => (
              <li key={g.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-800">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-black text-emerald-900">{g.actorLabel}</span>
                  <span className="text-xs font-bold text-slate-500">{g.bucketLabel}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(g.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                <ul className="mt-2 space-y-1">
                  {g.lines.map((line, i) => (
                    <li key={i} className="font-semibold">
                      {line}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`grid grid-cols-2 gap-4 ${canProfit ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <article className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white shadow-lg">
          <p className="text-sm font-bold uppercase tracking-wide text-white/80">{t(lang, "cardCashToday")}</p>
          <p className="mt-2 text-3xl font-black sm:text-4xl">UGX {cashToday.toLocaleString()}</p>
        </article>
        {canProfit ? (
          <article className="rounded-3xl bg-gradient-to-br from-emerald-600 to-emerald-800 p-5 text-white shadow-lg">
            <p className="text-sm font-bold uppercase tracking-wide text-white/90">{t(lang, "cardProfitToday")}</p>
            <p className="mt-2 text-3xl font-black sm:text-4xl">UGX {profitToday.toLocaleString()}</p>
          </article>
        ) : null}
        <article className="rounded-3xl border-4 border-rose-200 bg-rose-50 p-5 shadow-inner">
          <p className="text-sm font-black uppercase tracking-wide text-rose-900">{t(lang, "cardLowStock")}</p>
          <p className="mt-2 text-4xl font-black text-rose-950">{lowStockProducts.length}</p>
          <p className="mt-1 text-sm font-semibold text-rose-800">{t(lang, "almostFinishedHint")}</p>
        </article>
        <article className="rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-amber-950 shadow-lg">
          <p className="text-sm font-black uppercase tracking-wide text-amber-950/90">{t(lang, "cardDebtToday")}</p>
          <p className="mt-2 text-3xl font-black sm:text-4xl">UGX {debtToday.toLocaleString()}</p>
        </article>
      </section>

      {canProfit ? (
        <p className="text-center text-sm font-medium text-slate-500">
          {t(lang, "weekCashHint")}: <span className="font-bold text-slate-800">UGX {cashWeek.toLocaleString()}</span>
        </p>
      ) : null}

      <section className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-slate-900">{t(lang, "recentQuickSales")}</h2>
          <Link to="/receipts" className="text-sm font-bold text-emerald-700">
            {t(lang, "seeAll")}
          </Link>
        </div>
        {recentSales.length === 0 ? (
          <p className="mt-4 text-lg text-slate-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {recentSales.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                <span className="font-bold text-slate-800">UGX {s.totalUgx.toLocaleString()}</span>
                <span className="text-sm text-slate-500">{new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">{t(lang, "fastToday")}</h2>
        {fastMovers.length === 0 ? (
          <p className="mt-4 text-lg text-slate-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {fastMovers.map((m) => (
              <li key={m.name} className="flex items-center justify-between text-lg">
                <span className="font-bold text-slate-900">{m.name}</span>
                <span className="font-black text-emerald-700">UGX {m.revenue.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border-4 border-rose-200 bg-rose-50/80 p-5">
        <h2 className="text-xl font-black text-rose-950">{t(lang, "lowStockTitleFriendly")}</h2>
        {lowStockProducts.length === 0 ? (
          <p className="mt-4 text-lg font-medium text-rose-900/80">{t(lang, "stockOkFriendly")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {lowStockProducts.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-lg font-bold text-rose-950 shadow-sm">
                <span>{p.name}</span>
                <span className="text-rose-800">
                  {p.stockOnHand.toLocaleString()} {p.baseUnit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasPermission(actor.role, "reports.view") ? (
        <div className="flex justify-center pb-4">
          <Link to="/reports" className="text-lg font-bold text-slate-600 underline">
            {t(lang, "reports")} →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
