import { useMemo, useState } from "react";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { Link } from "react-router-dom";
import { PageBackBar } from "../components/layout/PageBackBar";
import { Building2, ClipboardList, Sparkles } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "../lib/datesUg";
import { scanTodaySalesHead } from "../lib/salesDayIndex";
import { isLowStock } from "../lib/sellingEngine";
import type { OwnerAlert } from "../lib/ownerAlerts";
import {
  buildDailyOwnerSummaryLines,
  buildWhatsAppOwnerSummaryLine,
  computeBusinessPulse,
  computeCashierTrustRows,
  computeExtendedOwnerAlerts,
  formatVsYesterday,
} from "../lib/ownerIntelligence";
import { computeTodayProfitBreakdown } from "../lib/homeProfit";

function alertLines(lang: Language, a: OwnerAlert): { title: string; detail: string } {
  const title = a.titleVars ? tTemplate(lang, a.title, a.titleVars) : t(lang, a.title);
  const detail = a.detailVars ? tTemplate(lang, a.detail, a.detailVars) : t(lang, a.detail);
  return { title, detail };
}

function pulseStyles(pulse: ReturnType<typeof computeBusinessPulse>): string {
  if (pulse === "strong") return "from-waka-600 to-teal-700 text-white";
  if (pulse === "steady") return "from-slate-700 to-slate-900 text-white";
  return "from-amber-500 to-orange-600 text-amber-950";
}

function pulseLabel(lang: Language, pulse: ReturnType<typeof computeBusinessPulse>): string {
  if (pulse === "strong") return t(lang, "ownerPulseStrong");
  if (pulse === "steady") return t(lang, "ownerPulseSteady");
  return t(lang, "ownerPulseWatch");
}

function trustBadgeClass(level: "good" | "warning" | "risky"): string {
  if (level === "good") return "bg-waka-500";
  if (level === "warning") return "bg-amber-400";
  return "bg-rose-500";
}

function trustLabel(lang: Language, level: "good" | "warning" | "risky"): string {
  if (level === "good") return t(lang, "trustGood");
  if (level === "warning") return t(lang, "trustWarning");
  return t(lang, "trustRisky");
}

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const sales = useDeferredReportingSales(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const preferences = usePosStore((s) => s.preferences);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const voidRecords = usePosStore((s) => s.voidRecords);
  const archivedVoidRecords = usePosStore((s) => s.archivedVoidRecords);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const allVoidRecords = includeArchived ? [...voidRecords, ...archivedVoidRecords] : voidRecords;
  const allReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);

  const [waCopied, setWaCopied] = useState(false);

  const todayKey = dateKeyKampala(new Date());
  const yesterdayKey = dateKeyDaysAgoKampala(1);

  const today = useMemo(
    () => scanTodaySalesHead(sales, todayKey).todaySales,
    [sales, todayKey],
  );

  const todayVoids = useMemo(
    () => allVoidRecords.filter((v) => dateKeyKampala(v.createdAt) === todayKey),
    [allVoidRecords, todayKey],
  );

  const todayReturns = useMemo(
    () => allReturnRecords.filter((r) => dateKeyKampala(r.createdAt) === todayKey),
    [allReturnRecords, todayKey],
  );

  const todayDiscountTotal = useMemo(
    () => today.reduce((a, s) => a + (s.discountTotalUgx ?? 0), 0),
    [today],
  );

  const todayDiscountEvents = useMemo(
    () =>
      auditLogs.filter(
        (e) => e.action === "discount_given" && dateKeyKampala(e.at) === todayKey,
      ),
    [auditLogs, todayKey],
  );

  const stats = useMemo(() => {
    const productById = new Map(products.map((p) => [p.id, p] as const));
    const netBreakdown = computeTodayProfitBreakdown(today, productById, todayReturns);
    const totalSalesUgx = netBreakdown.salesUgx;
    const voidsTotalUgx = todayVoids.reduce((a, v) => a + Math.max(0, v.amountUgx), 0);
    const expectedCashUgx = Math.max(
      0,
      today.reduce((a, s) => a + s.cashPaidUgx, 0) -
        todayReturns.reduce((a, r) => a + Math.max(0, r.refundAmountUgx), 0),
    );
    const debtTodayUgx = today.reduce((a, s) => a + s.debtUgx, 0);
    const estProfitUgx = netBreakdown.profitUgx;
    const returnsTotalUgx = todayReturns.reduce((a, r) => a + Math.max(0, r.refundAmountUgx), 0);
    const grossSalesUgx = totalSalesUgx + voidsTotalUgx + returnsTotalUgx;
    const closeToday = dayCloses.find((d) => d.dateKey === todayKey);
    const countedCashUgx = closeToday?.countedCashUgx ?? null;
    const todayCloseDiff = closeToday?.differenceUgx ?? null;
    const shortageUgx = closeToday && closeToday.differenceUgx < 0 ? -closeToday.differenceUgx : null;
    return {
      totalSalesUgx,
      grossSalesUgx,
      voidsTotalUgx,
      expectedCashUgx,
      debtTodayUgx,
      estProfitUgx,
      returnsTotalUgx,
      countedCashUgx,
      todayCloseDiff,
      shortageUgx,
      saleCount: today.length,
    };
  }, [today, products, todayReturns, todayVoids, dayCloses, todayKey]);

  const yesterdaySalesUgx = useMemo(
    () =>
      sales
        .filter((s) => dateKeyKampala(s.createdAt) === yesterdayKey)
        .reduce((a, s) => a + s.totalUgx, 0),
    [sales, yesterdayKey],
  );

  const lowStock = useMemo(() => products.filter((p) => isLowStock(p)), [products]);

  const fastMovers = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const sale of today) {
      for (const line of sale.lines) {
        if (line.voided) continue;
        const cur = map.get(line.productId) ?? { name: line.name, qty: 0, revenue: 0 };
        map.set(line.productId, {
          name: line.name,
          qty: cur.qty + line.quantity,
          revenue: cur.revenue + line.lineTotalUgx,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [today]);

  const cashierPerf = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const s of today) {
      const uid = s.soldByUserId ?? "unknown";
      const cur = map.get(uid) ?? { count: 0, revenue: 0 };
      map.set(uid, { count: cur.count + 1, revenue: cur.revenue + s.totalUgx });
    }
    return [...map.entries()]
      .map(([userId, v]) => ({
        userId,
        label: userId.startsWith("local:") ? userId.replace("local:", "") : userId.slice(0, 8) + "…",
        ...v,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [today]);

  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;

  const lastClose = dayCloses[0];

  const ownerAlertsResolved = useMemo(
    () =>
      computeExtendedOwnerAlerts({
        products,
        dayCloses,
        auditLogs: auditLogs,
        preferences,
        todayDebtUgx: stats.debtTodayUgx,
        sales,
        todayKey,
      }),
    [products, dayCloses, auditLogs, preferences, stats.debtTodayUgx, sales, todayKey],
  );

  const dangerCount = ownerAlertsResolved.filter((a) => a.tone === "danger").length;
  const warnCount = ownerAlertsResolved.filter((a) => a.tone === "warn").length;

  const pulse = useMemo(
    () =>
      computeBusinessPulse({
        todaySalesUgx: stats.totalSalesUgx,
        yesterdaySalesUgx,
        alertDangerCount: dangerCount,
        alertWarnCount: warnCount,
      }),
    [stats.totalSalesUgx, yesterdaySalesUgx, dangerCount, warnCount],
  );

  const topProduct = fastMovers[0]?.name ?? null;
  const lowProduct = lowStock[0]?.name ?? null;
  const debtSaleCount = useMemo(
    () => today.filter((s) => s.debtUgx > 0).length,
    [today],
  );

  const summaryInput = useMemo(
    () => ({
      totalSalesUgx: stats.totalSalesUgx,
      estProfitUgx: stats.estProfitUgx,
      debtTodayUgx: stats.debtTodayUgx,
      saleCount: stats.saleCount,
      debtSaleCount,
      topProductName: topProduct,
      lowProductName: lowProduct,
      cashShortUgx: stats.shortageUgx,
      yesterdaySalesUgx,
    }),
    [stats, debtSaleCount, topProduct, lowProduct, yesterdaySalesUgx],
  );

  const summaryLines = useMemo(() => buildDailyOwnerSummaryLines(lang, summaryInput), [lang, summaryInput]);
  const waLine = useMemo(() => buildWhatsAppOwnerSummaryLine(lang, summaryInput), [lang, summaryInput]);

  const trustRows = useMemo(
    () => computeCashierTrustRows(lang, today, auditLogs, todayKey),
    [lang, today, auditLogs, todayKey],
  );
  const activeShift = useMemo(() => shifts.find((s) => !s.endAt) ?? null, [shifts]);

  const trendLine = useMemo(
    () => formatVsYesterday(lang, stats.totalSalesUgx, yesterdaySalesUgx),
    [lang, stats.totalSalesUgx, yesterdaySalesUgx],
  );

  const quickAnswers = useMemo(() => {
    const didWell = stats.totalSalesUgx >= yesterdaySalesUgx * 0.85 || stats.totalSalesUgx >= 100_000;
    const moneyOk = stats.shortageUgx === null || stats.shortageUgx === 0;
    const fast = fastMovers[0]?.name ?? "—";
    const finishing = lowStock[0]?.name ?? t(lang, "allStockOk");
    const unusual = ownerAlertsResolved.length > 0 ? t(lang, "ownerPulseWatch") : t(lang, "ownerVarianceOk");
    const best = cashierPerf[0]?.label ?? "—";
    return { didWell, moneyOk, fast, finishing, unusual, best };
  }, [stats, yesterdaySalesUgx, fastMovers, lowStock, ownerAlertsResolved, cashierPerf, lang]);

  const copyWa = () => {
    void navigator.clipboard.writeText(waLine).then(
      () => {
        setWaCopied(true);
        window.setTimeout(() => setWaCopied(false), 2500);
      },
      () => {},
    );
  };

  return (
    <div className="space-y-6 pb-12">
      <PageBackBar lang={lang} fallbackTo="/office" label={t(lang, "officeBackToHub")} />
      <header className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-waka-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-waka-600 text-white shadow-md">
            <Building2 className="h-8 w-8" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-waka-800">{t(lang, "ownerControlTitle")}</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">{t(lang, "ownerDashboardTitle")}</h1>
            <p className="mt-1 max-w-prose text-slate-600">{t(lang, "ownerControlSub")}</p>
          </div>
        </div>
      </header>

      <IncludeArchivedFilter lang={lang} checked={includeArchived} onChange={setIncludeArchived} />

      <div className="flex flex-wrap gap-2">
        <Link
          to="/owner/activity"
          className="inline-flex items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm"
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          {t(lang, "staffActivityNav")}
        </Link>
        <Link
          to="/reports"
          className="inline-flex items-center gap-2 rounded-2xl border-2 border-waka-200 bg-waka-50 px-4 py-3 text-sm font-bold text-waka-950"
        >
          {t(lang, "reports")}
        </Link>
        <Link
          to="/close-day"
          className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950"
        >
          {t(lang, "closeDay")}
        </Link>
      </div>

      <section className={`rounded-[1.75rem] bg-gradient-to-br p-6 shadow-md ${pulseStyles(pulse)}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 shrink-0 opacity-90" aria-hidden />
            <p className="text-lg font-black">{pulseLabel(lang, pulse)}</p>
          </div>
          <p className={`text-sm font-semibold ${pulse === "watch" ? "text-amber-950/90" : "text-white/90"}`}>
            {trendLine}
          </p>
        </div>
        <p className={`mt-2 text-sm font-medium ${pulse === "watch" ? "text-amber-950/80" : "text-white/85"}`}>
          UGX {stats.totalSalesUgx.toLocaleString()} · {stats.saleCount} {t(lang, "salesCount")}
        </p>
        <p className={`mt-1 text-xs font-semibold ${pulse === "watch" ? "text-amber-950/80" : "text-white/80"}`}>
          Net sales: UGX {stats.grossSalesUgx.toLocaleString()} - UGX {stats.voidsTotalUgx.toLocaleString()} - UGX{" "}
          {stats.returnsTotalUgx.toLocaleString()} = UGX {stats.totalSalesUgx.toLocaleString()}
        </p>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "ownerDailySummaryTitle")}</h2>
          <button
            type="button"
            onClick={() => copyWa()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
          >
            {t(lang, "ownerCopyWaSummary")}
          </button>
        </div>
        {waCopied ? <p className="mt-2 text-sm font-semibold text-waka-700">{t(lang, "ownerCopiedWa")}</p> : null}
        <ul className="mt-4 space-y-2 text-sm font-semibold text-slate-800">
          {summaryLines.map((line) => (
            <li key={line} className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-waka-600">●</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[1.75rem] border border-slate-100 bg-slate-50/80 p-5">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-600">{t(lang, "ownerHealthTitle")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <article className="rounded-2xl border border-white bg-white p-4 shadow-sm">
            <p className="text-xs font-bold text-slate-500">{t(lang, "ownerCardSalesToday")}</p>
            <p className="mt-1 text-2xl font-black text-slate-900">UGX {stats.totalSalesUgx.toLocaleString()}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{t(lang, "ownerVsYesterday")}: {trendLine}</p>
          </article>
          <article className="rounded-2xl border border-white bg-white p-4 shadow-sm">
            <p className="text-xs font-bold text-slate-500">{t(lang, "estimatedProfit")}</p>
            <p className={`mt-1 text-2xl font-black ${stats.estProfitUgx < 0 ? "text-slate-600" : "text-waka-800"}`}>
              UGX {stats.estProfitUgx.toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {stats.estProfitUgx < 0 ? t(lang, "estimatedProfitNegativeHint") : t(lang, "estimatedProfitHint")}
            </p>
          </article>
        </div>
      </section>

      {ownerAlertsResolved.length > 0 ? (
        <section>
          <p className="mb-2 text-sm font-black uppercase tracking-wide text-amber-900">{t(lang, "ownerAlertsTitle")}</p>
          <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:mx-0 md:flex-wrap">
            {ownerAlertsResolved.map((a) => {
              const { title, detail } = alertLines(lang, a);
              return (
                <div
                  key={a.id}
                  className={`min-w-[min(100%,280px)] shrink-0 snap-start rounded-2xl border-2 px-4 py-3 shadow-sm md:min-w-0 md:flex-1 ${
                    a.tone === "danger"
                      ? "border-rose-200 bg-rose-50"
                      : a.tone === "warn"
                        ? "border-amber-200 bg-amber-50"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="text-sm font-black text-slate-900">{title}</p>
                  <p className="mt-1 text-xs font-medium text-slate-700">{detail}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">{t(lang, "ownerQuestionsTitle")}</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="font-bold text-slate-500">{t(lang, "ownerQDidWell")}</dt>
            <dd className="font-semibold text-slate-900">
              {quickAnswers.didWell ? t(lang, "ownerPulseStrong") : t(lang, "ownerPulseWatch")}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="font-bold text-slate-500">{t(lang, "ownerQMoney")}</dt>
            <dd className="font-semibold text-slate-900">{quickAnswers.moneyOk ? t(lang, "ownerSummaryCashOk") : t(lang, "ownerPulseWatch")}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="font-bold text-slate-500">{t(lang, "ownerQFast")}</dt>
            <dd className="font-semibold text-slate-900">{quickAnswers.fast}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="font-bold text-slate-500">{t(lang, "ownerQFinishing")}</dt>
            <dd className="font-semibold text-slate-900">{quickAnswers.finishing}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="font-bold text-slate-500">{t(lang, "ownerQSuspicious")}</dt>
            <dd className="font-semibold text-slate-900">{quickAnswers.unusual}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="font-bold text-slate-500">{t(lang, "ownerQBest")}</dt>
            <dd className="font-semibold text-slate-900">{quickAnswers.best}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-[1.75rem] border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-5">
        <h2 className="text-base font-black text-slate-800">{t(lang, "branchCardTitle")}</h2>
        <p className="mt-2 text-sm text-slate-600">{t(lang, "branchCardSub")}</p>
        {preferences.branchDisplayName ? (
          <p className="mt-3 text-sm font-bold text-waka-800">{preferences.branchDisplayName}</p>
        ) : null}
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">{t(lang, "trustTitle")}</h2>
        {trustRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t(lang, "noSalesYet")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {trustRows.map((row) => (
              <li
                key={row.userId}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
              >
                <span className={`inline-block h-10 w-1.5 rounded-full ${trustBadgeClass(row.trustLevel)}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black text-slate-900" title={row.userId}>
                    {row.displayLabel}
                  </p>
                  <p className="text-xs font-medium text-slate-600">
                    {t(lang, "trustSales")}: {row.salesHandled} · {t(lang, "trustStockEdits")}: {row.stockEdits} ·{" "}
                    {t(lang, "trustDebtIssued")}: UGX {row.debtIssuedUgx.toLocaleString()}
                    {row.refundLikeCount > 0 ? (
                      <>
                        {" "}
                        · {t(lang, "trustRefunds")}: {row.refundLikeCount}
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase text-slate-500">{t(lang, "trustScore")}</p>
                  <p className="text-lg font-black text-slate-900">{row.reliabilityScore}</p>
                  <p className="text-xs font-bold text-slate-600">{trustLabel(lang, row.trustLevel)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[1.75rem] border border-rose-100 bg-rose-50/40 p-5 shadow-sm">
          <h2 className="text-lg font-black text-rose-950">{t(lang, "ownerVoidsToday")}</h2>
          {todayVoids.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-rose-900/70">{t(lang, "ownerNoVoidsToday")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {todayVoids.slice(0, 8).map((v) => (
                <li key={v.id} className="rounded-2xl border border-rose-100 bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-700">{t(lang, "voidBtn")}</p>
                  <p className="mt-1 font-black text-slate-900">
                    {v.productName} · UGX {v.amountUgx.toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    {tTemplate(lang, "ownerVoidBy", { name: v.actorName ?? v.actorUserId })}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t(lang, `voidReason_${v.reason}`)} · {new Date(v.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-[1.75rem] border border-amber-100 bg-amber-50/40 p-5 shadow-sm">
          <h2 className="text-lg font-black text-amber-950">{t(lang, "ownerDiscountsToday")}</h2>
          {todayDiscountTotal <= 0 && todayDiscountEvents.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-amber-900/70">{t(lang, "ownerNoDiscountsToday")}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {todayDiscountTotal > 0 ? (
                <p className="rounded-2xl border border-amber-100 bg-white p-3 text-xl font-black text-amber-950">
                  UGX {todayDiscountTotal.toLocaleString()}
                </p>
              ) : null}
              {todayDiscountEvents.slice(0, 6).map((e) => (
                <div key={e.id} className="rounded-2xl border border-amber-100 bg-white p-3 text-sm font-semibold text-slate-700">
                  {e.payloadSummary}
                  <p className="mt-1 text-xs text-slate-500">
                    {e.actorName ?? e.actorUserId} · {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/60 p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "returnRefundLabel")}</h2>
          {todayReturns.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-slate-600">{t(lang, "noSalesYet")}</p>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="rounded-2xl border border-slate-200 bg-white p-3 text-xl font-black text-slate-900">
                UGX {stats.returnsTotalUgx.toLocaleString()}
              </p>
              <ul className="space-y-2">
                {todayReturns.slice(0, 6).map((r) => (
                  <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="font-black text-slate-900">
                      {r.productName} · UGX {r.refundAmountUgx.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "fastToday")}</h2>
          {fastMovers.length === 0 ? (
            <p className="mt-3 text-slate-500">{t(lang, "noSalesYet")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {fastMovers.map((m) => (
                <li key={m.name} className="flex justify-between text-sm font-semibold">
                  <span>{m.name}</span>
                  <span className="text-waka-700">UGX {m.revenue.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "ownerCashierPerf")}</h2>
          {cashierPerf.length === 0 ? (
            <p className="mt-3 text-slate-500">{t(lang, "noSalesYet")}</p>
          ) : (
            <>
              <p className="mt-1 text-xs font-bold text-waka-800">
                {t(lang, "ownerBestCashier")}: {cashierPerf[0]?.label}
              </p>
              <ul className="mt-3 space-y-2">
                {cashierPerf.map((row) => (
                  <li key={row.userId} className="flex justify-between text-sm font-semibold">
                    <span className="truncate pr-2" title={row.userId}>
                      {row.label}
                    </span>
                    <span className="shrink-0 text-slate-600">
                      {row.count} · UGX {row.revenue.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-slate-500">{t(lang, "ownerCashierPerfHint")}</p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">{t(lang, "ownerCardExpectedCash")}</p>
          <p className="mt-1 text-xl font-black text-slate-900">UGX {stats.expectedCashUgx.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">{t(lang, "ownerCardCountedCash")}</p>
          <p className="mt-1 text-xl font-black text-slate-900">
            {stats.countedCashUgx !== null ? `UGX ${stats.countedCashUgx.toLocaleString()}` : "—"}
          </p>
          {stats.todayCloseDiff !== null ? (
            <p
              className={`mt-1 text-xs font-bold ${
                stats.todayCloseDiff === 0 ? "text-waka-700" : stats.todayCloseDiff > 0 ? "text-amber-800" : "text-rose-700"
              }`}
            >
              {t(lang, "ownerShortOver")}: UGX {stats.todayCloseDiff.toLocaleString()}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">{t(lang, "ownerNoCloseYet")}</p>
          )}
        </article>
        <article className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 shadow-sm sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-bold uppercase text-amber-900">{t(lang, "debtToday")}</p>
          <p className="mt-1 text-xl font-black text-amber-900">UGX {stats.debtTodayUgx.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">{t(lang, "activeCashierCard")}</p>
          <p className="mt-1 text-xl font-black text-slate-900">{activeShift?.actorName ?? "—"}</p>
        </article>
        <article className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase text-slate-500">{t(lang, "currentShiftCard")}</p>
          <p className="mt-1 text-xl font-black text-slate-900">
            {activeShift ? new Date(activeShift.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
          </p>
        </article>
      </section>

      {lastClose ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5">
          <p className="font-black text-slate-900">{t(lang, "ownerLastClose")}</p>
          <p className="mt-1 text-sm text-slate-600">
            {lastClose.dateKey} · {t(lang, "ownerExpectedVsCounted")}: UGX {lastClose.expectedCashUgx.toLocaleString()} / UGX{" "}
            {lastClose.countedCashUgx.toLocaleString()}
          </p>
          {(() => {
            const exp = Math.max(1, lastClose.expectedCashUgx);
            const absDiff = Math.abs(lastClose.differenceUgx);
            const threshold = Math.max((pct / 100) * exp, fixed);
            const suspicious = absDiff > threshold;
            return suspicious ? (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950 ring-1 ring-amber-200">
                {t(lang, "ownerVarianceFlag")} (±{pct}% / UGX {fixed.toLocaleString()})
              </p>
            ) : (
              <p className="mt-2 text-sm font-semibold text-waka-800">{t(lang, "ownerVarianceOk")}</p>
            );
          })()}
        </section>
      ) : null}

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">{t(lang, "customers")}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {t(lang, "ownerDebtHint")}:{" "}
          <span className="font-bold text-amber-800">
            UGX {customers.reduce((a, c) => a + c.debtBalanceUgx, 0).toLocaleString()}
          </span>
        </p>
        <Link to="/customers" className="mt-3 inline-block text-sm font-bold text-waka-700 underline">
          {t(lang, "customers")} →
        </Link>
      </section>
    </div>
  );
}
