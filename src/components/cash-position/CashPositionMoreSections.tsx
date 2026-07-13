import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, User } from "lucide-react";
import type { CashDrawerAdjustmentType, Language } from "../../types";
import { CASH_DRAWER_ADJUSTMENT_TYPES } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { cashDrawerAdjustmentTypeLabel } from "../../lib/cashDrawerLedger";
import { CashDenominationCountField } from "../cash/CashDenominationCountField";
import type {
  CashPositionAlert,
  CashPositionCashierDetail,
  CashPositionCategoryDetail,
} from "../../lib/cashPositionDashboard";
import { receiptPrintActionLabel } from "../../lib/printActionLabels";
import { ModalSheet } from "../layout/ModalSheet";

export function CashPositionCashCount({
  lang,
  expectedUgx,
  closeDateKey,
  onUseTotal,
}: {
  lang: Language;
  expectedUgx: number;
  closeDateKey: string;
  onUseTotal: (total: number) => void;
}) {
  const [value, setValue] = useState("");

  const activeTotal = Math.max(0, Math.floor(Number(value.replace(/\D/g, "")) || 0));
  const closeDayUrl = `/close-day?date=${encodeURIComponent(closeDateKey)}#cash-count`;

  return (
    <div className="space-y-4">
      <CashDenominationCountField
        lang={lang}
        value={value}
        onChange={setValue}
        expectedUgx={expectedUgx}
        showVariance
      />
      <Link
        to={closeDayUrl}
        onClick={() => {
          if (activeTotal > 0) onUseTotal(activeTotal);
        }}
        className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white"
      >
        {t(lang, "cashPositionSaveCountCloseDay")}
      </Link>
      <p className="text-center text-xs font-medium text-muted-foreground">{t(lang, "cashPositionCountPersistHint")}</p>
    </div>
  );
}

export function CashPositionMovementForm({
  lang,
  actorLabel,
  movementType,
  movementAmount,
  movementReason,
  movementNote,
  movementMsg,
  onTypeChange,
  onAmountChange,
  onReasonChange,
  onNoteChange,
  onSubmit,
}: {
  lang: Language;
  actorLabel: string;
  movementType: CashDrawerAdjustmentType;
  movementAmount: string;
  movementReason: string;
  movementNote: string;
  movementMsg: string | null;
  onTypeChange: (t: CashDrawerAdjustmentType) => void;
  onAmountChange: (v: string) => void;
  onReasonChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "cashPositionMovementType")}
        <select
          value={movementType}
          onChange={(e) => onTypeChange(e.target.value as CashDrawerAdjustmentType)}
          className="mt-2 w-full rounded-2xl border-2 border-border bg-muted px-4 py-3 text-sm font-semibold"
        >
          {CASH_DRAWER_ADJUSTMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {cashDrawerAdjustmentTypeLabel(lang, type)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "cashPositionMovementAmount")}
        <input
          value={movementAmount}
          onChange={(e) => onAmountChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          placeholder="0"
          className="mt-2 w-full rounded-2xl border-2 border-border bg-muted px-4 py-3 text-xl font-black tabular-nums"
        />
      </label>
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "cashPositionMovementReason")}
        <input
          value={movementReason}
          onChange={(e) => onReasonChange(e.target.value.slice(0, 80))}
          className="mt-2 w-full rounded-2xl border-2 border-border bg-muted px-4 py-3 text-sm font-medium"
        />
      </label>
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "cashPositionMovementNote")}
        <input
          value={movementNote}
          onChange={(e) => onNoteChange(e.target.value.slice(0, 120))}
          className="mt-2 w-full rounded-2xl border-2 border-border bg-muted px-4 py-3 text-sm font-medium"
        />
      </label>
      <p className="text-xs font-semibold text-muted-foreground">
        {t(lang, "cashPositionMovementBy")}: {actorLabel}
      </p>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!movementAmount.replace(/\D/g, "") || !movementReason.trim()}
        className="min-h-[48px] w-full rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
      >
        {t(lang, "save")}
      </button>
      {movementMsg ? <p className="text-sm font-bold text-waka-800">{movementMsg}</p> : null}
    </div>
  );
}

export function CashPositionCategories({
  lang,
  categories,
}: {
  lang: Language;
  categories: CashPositionCategoryDetail[];
}) {
  const [selected, setSelected] = useState<CashPositionCategoryDetail | null>(null);

  if (categories.length === 0) {
    return <p className="text-base font-medium text-muted-foreground">{t(lang, "cashPositionNoSalesToday")}</p>;
  }

  return (
    <>
      <ul className="space-y-2">
        {categories.map((row) => (
          <li key={row.categoryKey}>
            <button
              type="button"
              onClick={() => setSelected(row)}
              className="w-full rounded-2xl bg-muted px-4 py-3 text-left transition active:bg-muted"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-foreground">{row.categoryLabel}</p>
                <p className="text-lg font-black tabular-nums text-waka-800">UGX {row.amountUgx.toLocaleString()}</p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-waka-500" style={{ width: `${Math.min(100, row.percent)}%` }} />
              </div>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {row.percent}% · {row.itemsSold} {t(lang, "cashPositionItemsSold").toLowerCase()}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <ModalSheet open={Boolean(selected)} title={selected.categoryLabel} onClose={() => setSelected(null)}>
          <ul className="space-y-2">
            {selected.products.map((p) => (
              <li key={p.productId} className="flex justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                <span className="font-bold text-foreground">
                  {p.name} × {p.qty}
                </span>
                <span className="font-black tabular-nums">UGX {p.amountUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </ModalSheet>
      ) : null}
    </>
  );
}

export function CashPositionCashiers({ lang, cashiers }: { lang: Language; cashiers: CashPositionCashierDetail[] }) {
  if (cashiers.length === 0) {
    return <p className="text-base font-medium text-muted-foreground">{t(lang, "cashPositionNoSalesToday")}</p>;
  }

  return (
    <ul className="space-y-2">
      {cashiers.map((row) => (
        <li key={row.cashierId} className="rounded-2xl border border-border bg-muted px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-waka-100 text-waka-700">
              <User className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-black text-background">
                  #{row.rank}
                </span>
                <p className="truncate font-bold text-foreground">{row.name}</p>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <dt className="font-semibold text-muted-foreground">{t(lang, "cashPositionTotalSales")}</dt>
                  <dd className="font-black tabular-nums">UGX {row.salesUgx.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">{t(lang, "cashPositionTransactions")}</dt>
                  <dd className="font-black">{row.transactionCount}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">{t(lang, "cashPositionAverageSale")}</dt>
                  <dd className="font-black tabular-nums">UGX {row.averageSaleUgx.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted-foreground">{t(lang, "cashPositionRefunds")}</dt>
                  <dd className="font-black tabular-nums text-rose-700">UGX {row.refundsUgx.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="mt-2 text-sm font-black text-waka-800">
                {t(lang, "cashPositionNetSales")}: UGX {row.netSalesUgx.toLocaleString()}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CashPositionAlertsPanel({ lang, alerts }: { lang: Language; alerts: CashPositionAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        {t(lang, "cashPositionAlertsClear")}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li
          key={a.id}
          className={clsx(
            "flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold",
            a.severity === "critical"
              ? "bg-rose-50 text-rose-950"
              : a.severity === "warning"
                ? "bg-amber-50 text-amber-950"
                : "bg-sky-50 text-sky-950",
          )}
        >
          {a.severity === "info" ? (
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          {a.message}
        </li>
      ))}
    </ul>
  );
}

export function CashPositionSafeLimit({
  lang,
  safeLimit,
  limitInput,
  onLimitChange,
  onSaveLimit,
}: {
  lang: Language;
  safeLimit: { limitUgx: number | null; currentCashUgx: number; remainingUgx: number | null; exceeded: boolean };
  limitInput: string;
  onLimitChange: (v: string) => void;
  onSaveLimit: () => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "cashPositionSafeLimitLabel")}
        <input
          value={limitInput}
          onChange={(e) => onLimitChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          placeholder="0"
          className="mt-2 w-full rounded-2xl border-2 border-border bg-muted px-4 py-3 text-lg font-black tabular-nums"
        />
      </label>
      <button
        type="button"
        onClick={onSaveLimit}
        className="min-h-[40px] rounded-xl bg-foreground px-4 py-2 text-xs font-black text-background"
      >
        {t(lang, "save")}
      </button>
      {safeLimit.limitUgx != null && safeLimit.limitUgx > 0 ? (
        <dl className="grid gap-2 rounded-2xl bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <dt className="font-bold text-muted-foreground">{t(lang, "cashPositionCurrentDrawer")}</dt>
            <dd className="font-black tabular-nums">UGX {safeLimit.currentCashUgx.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-bold text-muted-foreground">{t(lang, "cashPositionSafeLimitLabel")}</dt>
            <dd className="font-black tabular-nums">UGX {safeLimit.limitUgx.toLocaleString()}</dd>
          </div>
          {safeLimit.remainingUgx != null ? (
            <div className="flex justify-between">
              <dt className="font-bold text-muted-foreground">{t(lang, "cashPositionSafeRemaining")}</dt>
              <dd className="font-black tabular-nums">UGX {safeLimit.remainingUgx.toLocaleString()}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {safeLimit.exceeded ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {t(lang, "cashPositionSafeExceeded")}
        </p>
      ) : null}
    </div>
  );
}

export function CashPositionPreviousCounts({
  lang,
  rows,
}: {
  lang: Language;
  rows: Array<{ dateKey: string; differenceUgx: number; kind: import("../../lib/cashPosition").CashPositionVariance }>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm font-medium text-muted-foreground">{t(lang, "cashPositionPreviousEmpty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.dateKey}>
          <Link
            to="/close-day"
            className="flex items-center justify-between rounded-xl bg-muted px-3 py-2.5 text-sm transition active:bg-muted"
          >
            <span className="font-bold text-foreground">{row.dateKey}</span>
            <span
              className={clsx(
                "font-black tabular-nums",
                row.kind === "balanced" ? "text-emerald-700" : row.kind === "shortage" ? "text-rose-700" : "text-sky-700",
              )}
            >
              {row.kind === "balanced"
                ? t(lang, "cashPositionBalanced")
                : row.kind === "shortage"
                  ? tTemplate(lang, "cashPositionShortBy", { amount: Math.abs(row.differenceUgx).toLocaleString() })
                  : tTemplate(lang, "cashPositionOverBy", { amount: row.differenceUgx.toLocaleString() })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CashPositionDailyNotes({
  lang,
  note,
  onChange,
  onSave,
}: {
  lang: Language;
  note: string;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <textarea
        value={note}
        onChange={(e) => onChange(e.target.value.slice(0, 500))}
        rows={4}
        placeholder={t(lang, "cashPositionNotesPlaceholder")}
        className="w-full rounded-2xl border-2 border-border bg-muted px-4 py-3 text-sm font-medium"
      />
      <button
        type="button"
        onClick={onSave}
        className="min-h-[40px] rounded-xl bg-waka-600 px-4 py-2 text-xs font-black text-white"
      >
        {t(lang, "save")}
      </button>
    </div>
  );
}

export function CashPositionExportCenter({
  lang,
  exportBusy,
  exportHint,
  onPrint,
  onPdf,
  onCsv,
  onExcel,
  onShare,
  onEmail,
  onWhatsApp,
  onPreview,
}: {
  lang: Language;
  exportBusy: boolean;
  exportHint: string | null;
  onPrint: () => void;
  onPdf: () => void;
  onCsv: () => void;
  onExcel: () => void;
  onShare: () => void;
  onEmail: () => void;
  onWhatsApp: () => void;
  onPreview: () => void;
}) {
  const btn =
    "min-h-[44px] rounded-2xl px-3 py-2.5 text-xs font-black disabled:opacity-60";
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <button type="button" disabled={exportBusy} onClick={onPrint} className={`${btn} bg-foreground text-background`}>
          {receiptPrintActionLabel(lang)}
        </button>
        <button type="button" disabled={exportBusy} onClick={onPdf} className={`${btn} bg-waka-600 text-white`}>
          {t(lang, "cashPositionExportPdf")}
        </button>
        <button type="button" disabled={exportBusy} onClick={onCsv} className={`${btn} border-2 border-border bg-card`}>
          {t(lang, "cashPositionExportCsv")}
        </button>
        <button type="button" disabled={exportBusy} onClick={onExcel} className={`${btn} border-2 border-border bg-card`}>
          {t(lang, "cashPositionExportExcel")}
        </button>
        <button type="button" disabled={exportBusy} onClick={onShare} className={`${btn} border-2 border-waka-300 bg-waka-50 text-waka-900`}>
          {t(lang, "cashPositionExportShare")}
        </button>
        <button type="button" disabled={exportBusy} onClick={onEmail} className={`${btn} border-2 border-border bg-card`}>
          {t(lang, "cashPositionExportEmail")}
        </button>
        <button type="button" disabled={exportBusy} onClick={onWhatsApp} className={`${btn} border-2 border-emerald-300 bg-emerald-50 text-emerald-950`}>
          {t(lang, "cashPositionExportWhatsApp")}
        </button>
        <button type="button" disabled={exportBusy} onClick={onPreview} className={`${btn} border-2 border-border bg-card`}>
          {t(lang, "cashPositionExportPreview")}
        </button>
      </div>
      {exportHint ? <p className="text-center text-sm font-bold text-waka-800">{exportHint}</p> : null}
    </div>
  );
}
