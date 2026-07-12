import { Link } from "react-router-dom";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Calculator,
  Download,
  PlusCircle,
} from "lucide-react";
import type { Language, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { cashDrawerAdjustmentTypeLabel } from "../../lib/cashDrawerLedger";
import {
  classifyCashVariance,
  computeCashVarianceThresholdUgx,
  varianceStateLabelKey,
  varianceStateStatusKind,
} from "../../lib/cashVarianceExperience";
import { statusTokens } from "../../lib/statusTokens";

type Props = {
  lang: Language;
  onCountCash: () => void;
  onAddCash: () => void;
  onRemoveCash: () => void;
  onBankDeposit: () => void;
  onExport: () => void;
};

export function CashPositionQuickActions({
  lang,
  onCountCash,
  onAddCash,
  onRemoveCash,
  onBankDeposit,
  onExport,
}: Props) {
  const actions = [
    { id: "count", label: t(lang, "cashPositionQuickCount"), icon: Calculator, onClick: onCountCash },
    { id: "add", label: t(lang, "cashPositionQuickAdd"), icon: PlusCircle, onClick: onAddCash },
    { id: "remove", label: t(lang, "cashPositionQuickRemove"), icon: ArrowDownCircle, onClick: onRemoveCash },
    { id: "bank", label: t(lang, "cashPositionQuickBank"), icon: Banknote, onClick: onBankDeposit },
    { id: "export", label: t(lang, "cashPositionQuickExport"), icon: Download, onClick: onExport },
  ] as const;

  return (
    <div className="sticky top-0 z-20 -mx-1 border-b border-border/80 bg-[#f8f6f3]/95 px-1 py-2 backdrop-blur-md">
      <div className="flex gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
        {actions.map(({ id, label, icon: Icon, onClick }) => (
          <button
            key={id}
            type="button"
            onClick={onClick}
            className="flex min-w-[5.5rem] shrink-0 flex-col items-center gap-1 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm transition active:scale-[0.98]"
          >
            <Icon className="h-5 w-5 text-waka-600" aria-hidden />
            <span className="text-center text-[10px] font-black leading-tight text-foreground">{label}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold text-muted-foreground">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {t(lang, "cashPositionCloseDayHint")}{" "}
        <Link to="/close-day" className="font-black text-waka-700 underline">
          {t(lang, "closeDay")}
        </Link>
      </p>
    </div>
  );
}

export function CashPositionHeroSummary({
  lang,
  extendedSummary,
  rangeLabel,
}: {
  lang: Language;
  extendedSummary: import("../../lib/cashPositionDashboard").CashPositionExtendedSummary;
  rangeLabel: string;
}) {
  const kpis = [
    { label: t(lang, "cashPositionTransactions"), value: extendedSummary.transactionCount.toLocaleString() },
    { label: t(lang, "cashPositionItemsSold"), value: extendedSummary.itemsSold.toLocaleString() },
    { label: t(lang, "cashPositionGrossProfit"), value: `UGX ${extendedSummary.grossProfitUgx.toLocaleString()}` },
    { label: t(lang, "cashPositionAverageSale"), value: `UGX ${extendedSummary.averageSaleUgx.toLocaleString()}` },
    { label: t(lang, "cashPositionLargestSale"), value: `UGX ${extendedSummary.largestSaleUgx.toLocaleString()}` },
  ];

  return (
    <div className="rounded-3xl border-2 border-stone-900 bg-gradient-to-br from-foreground to-foreground/80 p-5 text-white shadow-waka-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "cashPositionSectionToday")}</p>
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white/90">{rangeLabel}</span>
      </div>
      <p className="mt-1 text-xs font-semibold text-white/70">{t(lang, "cashPositionTotalSales")}</p>
      <p className="mt-1 text-4xl font-black tabular-nums sm:text-5xl">
        UGX {extendedSummary.totalSalesUgx.toLocaleString()}
      </p>
      {extendedSummary.currentDrawerCashUgx != null ? (
        <div className="mt-4 rounded-2xl bg-waka-500/30 px-4 py-3 ring-1 ring-white/20">
          <p className="text-[10px] font-black uppercase text-white/80">{t(lang, "cashPositionCurrentDrawer")}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-waka-100">
            UGX {extendedSummary.currentDrawerCashUgx.toLocaleString()}
          </p>
        </div>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl bg-white/10 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase text-white/70">{kpi.label}</p>
            <p className="mt-0.5 text-lg font-black tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const PAYMENT_COLORS: Record<string, string> = {
  cash: "bg-emerald-500",
  mobile_money: "bg-violet-500",
  card: "bg-sky-500",
  bank_transfer: "bg-indigo-500",
  credit: "bg-amber-500",
  gift_card: "bg-pink-500",
  other: "bg-stone-400",
};

export function paymentLabel(lang: Language, key: string): string {
  const map: Record<string, string> = {
    cash: t(lang, "cashPositionPayCash"),
    mobile_money: t(lang, "cashPositionPayMobile"),
    card: t(lang, "cashPositionPayCard"),
    bank_transfer: t(lang, "cashPositionPayBank"),
    credit: t(lang, "cashPositionPayCredit"),
    gift_card: t(lang, "cashPositionPayGift"),
    other: t(lang, "cashPositionPayOther"),
  };
  return map[key] ?? key;
}

export function CashPositionPaymentMethods({
  lang,
  report,
}: {
  lang: Language;
  report: import("../../lib/cashPosition").CashPositionReport;
}) {
  if (report.paymentMethods.length === 0 && report.paymentAdjustmentUgx === 0) {
    return <p className="text-base font-medium text-muted-foreground">{t(lang, "cashPositionNoSalesToday")}</p>;
  }

  return (
    <ul className="space-y-3">
      {report.paymentMethods.map((row) => (
        <li key={row.key} className="rounded-2xl bg-muted px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-foreground">{paymentLabel(lang, row.key)}</p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                {row.transactionCount} {t(lang, "cashPositionTxnLabel")}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={clsx("h-full rounded-full transition-all", PAYMENT_COLORS[row.key] ?? "bg-waka-500")}
                  style={{ width: `${Math.min(100, row.percent)}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-black tabular-nums text-foreground">UGX {row.amountUgx.toLocaleString()}</p>
              <p className="text-sm font-bold text-waka-700">{row.percent}%</p>
            </div>
          </div>
        </li>
      ))}
      {report.paymentAdjustmentUgx !== 0 ? (
        <li className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex justify-between gap-3">
            <p className="text-sm font-black text-amber-950">{t(lang, "cashPositionPaymentAdjustment")}</p>
            <p className="text-xl font-black tabular-nums text-amber-950">
              UGX {report.paymentAdjustmentUgx.toLocaleString()}
            </p>
          </div>
        </li>
      ) : null}
    </ul>
  );
}

export function CashPositionBreakdown({
  lang,
  report,
}: {
  lang: Language;
  report: import("../../lib/cashPosition").CashPositionReport;
}) {
  const cp = report.cashPosition;
  const bd = report.adjustmentBreakdown;

  const inflowLines = [
    { label: t(lang, "cashPositionCashSales"), value: cp.cashSalesUgx, sign: "+" as const },
    { label: t(lang, "cashPositionDebtCollected"), value: cp.debtCollectedUgx, sign: "+" as const },
    { label: cashDrawerAdjustmentTypeLabel(lang, "cash_added"), value: bd.cash_added ?? 0, sign: "+" as const },
    { label: cashDrawerAdjustmentTypeLabel(lang, "owner_injection"), value: bd.owner_injection ?? 0, sign: "+" as const },
    { label: cashDrawerAdjustmentTypeLabel(lang, "safe_transfer_in"), value: bd.safe_transfer_in ?? 0, sign: "+" as const },
    { label: t(lang, "cashPositionOpeningFloat"), value: cp.openingFloatUgx, sign: "+" as const },
  ].filter((l) => l.value > 0);

  const outflowLines = [
    { label: t(lang, "cashPositionSupplierPayments"), value: cp.supplierPaymentsUgx },
    { label: t(lang, "cashPositionExpenses"), value: cp.expensesUgx },
    { label: t(lang, "cashPositionRefunds"), value: cp.refundsUgx },
    { label: cashDrawerAdjustmentTypeLabel(lang, "cash_removed"), value: bd.cash_removed ?? 0 },
    { label: cashDrawerAdjustmentTypeLabel(lang, "owner_withdrawal"), value: bd.owner_withdrawal ?? 0 },
    { label: cashDrawerAdjustmentTypeLabel(lang, "bank_deposit"), value: bd.bank_deposit ?? 0 },
    { label: cashDrawerAdjustmentTypeLabel(lang, "safe_transfer_out"), value: bd.safe_transfer_out ?? 0 },
  ].filter((l) => l.value > 0);

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {inflowLines.map((line) => (
          <li key={line.label} className="flex justify-between rounded-xl bg-teal-50 px-3 py-2.5 text-sm">
            <span className="font-bold text-teal-950">{line.label}</span>
            <span className="font-black tabular-nums text-teal-900">+ UGX {line.value.toLocaleString()}</span>
          </li>
        ))}
        {outflowLines.map((line) => (
          <li key={line.label} className="flex justify-between rounded-xl bg-rose-50 px-3 py-2.5 text-sm">
            <span className="font-bold text-rose-950">{line.label}</span>
            <span className="font-black tabular-nums text-rose-900">− UGX {line.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-gradient-to-br from-waka-500 to-waka-700 px-4 py-5 text-white shadow-md">
        <p className="text-xs font-black uppercase tracking-wide text-white/80">{t(lang, "cashPositionExpectedCash")}</p>
        <p className="mt-1 text-3xl font-black tabular-nums sm:text-4xl">
          UGX {cp.expectedCashUgx.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export function CashPositionActivityTimeline({
  lang,
  events,
}: {
  lang: Language;
  events: import("../../lib/cashPositionDashboard").CashActivityEvent[];
}) {
  if (events.length === 0) {
    return <p className="text-sm font-medium text-muted-foreground">{t(lang, "cashPositionTimelineEmpty")}</p>;
  }

  return (
    <ul className="relative space-y-0 border-l-2 border-border pl-4">
      {events.map((ev) => (
        <li key={ev.id} className="relative pb-4 last:pb-0">
          <span
            className={clsx(
              "absolute -left-[1.35rem] top-1 flex h-3 w-3 rounded-full ring-2 ring-white",
              ev.amountUgx >= 0 ? "bg-emerald-500" : "bg-rose-500",
            )}
          />
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-muted-foreground">{ev.timeLabel}</p>
              <p className="text-sm font-bold text-foreground">{ev.label}</p>
            </div>
            <p
              className={clsx(
                "shrink-0 text-sm font-black tabular-nums",
                ev.amountUgx >= 0 ? "text-emerald-700" : "text-rose-700",
              )}
            >
              {ev.amountUgx >= 0 ? "+" : "−"} UGX {Math.abs(ev.amountUgx).toLocaleString()}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CashPositionDrawerStatus({
  lang,
  status,
  preferences,
}: {
  lang: Language;
  status: NonNullable<import("../../lib/cashPositionDashboard").CashPositionDashboardResult["drawerStatus"]>;
  preferences?: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">;
}) {
  const kind = status.kind;
  const assessment =
    preferences && status.countedCashUgx != null
      ? classifyCashVariance(status.expectedCashUgx, status.countedCashUgx, preferences, "day_close")
      : null;
  const toleranceUgx = preferences ? computeCashVarianceThresholdUgx(status.expectedCashUgx, preferences) : null;
  const cardClass = assessment
    ? statusTokens[varianceStateStatusKind(assessment.state)].banner
    : kind === "balanced"
      ? "rounded-2xl border-2 border-success/30 bg-success-muted p-4"
      : kind === "shortage"
        ? "rounded-2xl border-2 border-danger/30 bg-danger-muted p-4"
        : kind === "excess"
          ? "rounded-2xl border-2 border-warning/30 bg-warning-muted p-4"
          : "rounded-2xl border-2 border-border bg-muted p-4";

  const statusLabel = assessment
    ? t(lang, varianceStateLabelKey(assessment.state))
    : kind === "balanced"
      ? t(lang, "cashPositionBalanced")
      : kind === "shortage"
        ? t(lang, "cashPositionDrawerShort")
        : kind === "excess"
          ? t(lang, "cashPositionDrawerOver")
          : t(lang, "cashPositionDrawerPending");

  return (
    <div className={cardClass}>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-bold text-muted-foreground">{t(lang, "cashPositionExpectedLabel")}</dt>
          <dd className="text-xl font-black tabular-nums">UGX {status.expectedCashUgx.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-muted-foreground">{t(lang, "cashPositionActualLabel")}</dt>
          <dd className="text-xl font-black tabular-nums">
            {status.countedCashUgx != null ? `UGX ${status.countedCashUgx.toLocaleString()}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-muted-foreground">{t(lang, "cashPositionVariance")}</dt>
          <dd className="text-xl font-black tabular-nums">
            {status.varianceUgx != null
              ? `${status.varianceUgx >= 0 ? "+" : ""}UGX ${status.varianceUgx.toLocaleString()}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-muted-foreground">{t(lang, "drawerVarianceTolerance")}</dt>
          <dd className="text-xl font-black tabular-nums">
            {toleranceUgx != null ? `±UGX ${toleranceUgx.toLocaleString()}` : "—"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-center text-sm font-black">{statusLabel}</p>
      {status.countedCashUgx == null ? (
        <Link
          to="/close-day"
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white"
        >
          <ArrowUpCircle className="h-4 w-4" aria-hidden />
          {t(lang, "cashPositionGoCloseDay")}
        </Link>
      ) : null}
    </div>
  );
}
