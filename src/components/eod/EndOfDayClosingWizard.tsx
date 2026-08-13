import clsx from "clsx";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  EOD_WIZARD_STEP_META,
  eodWizardCanLeaveCashStep,
  eodWizardNextStep,
  eodWizardPrevStep,
  type EodWizardStepId,
} from "../../lib/endOfDayWizard";
import type { EndOfDayCloseSession } from "../../hooks/useEndOfDayCloseSession";
import { CloseDayPreflightPanel } from "../office/CloseDayPreflightPanel";
import { HomeBusinessHealthSection } from "../home/HomeBusinessHealthSection";
import { CashVarianceSummary } from "../cash/CashVarianceSummary";
import { EnterpriseApprovalPinPad } from "../auth/EnterpriseApprovalPinPad";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Caption, MonoNumber, SectionTitle } from "../enterprise/EnterpriseTypography";
import { WakaSwitch } from "../enterprise/WakaSwitch";
import { DocumentActionsBar } from "../documents/DocumentActionsBar";
import { downloadDayClosePdf, printDayCloseReport, shareDayClosePdf } from "../../lib/dayCloseDocument";

type Props = {
  lang: Language;
  session: EndOfDayCloseSession;
};

const TENDER_LABEL: Record<string, string> = {
  cash: "eodTenderDeclaredCash",
  card: "eodTenderReportedCard",
  mobile_money: "eodTenderReportedMomo",
  bank_transfer: "eodTenderReportedBank",
  credit: "eodTenderReportedCredit",
};

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{label}</p>
      <MonoNumber className="mt-0.5 text-base sm:text-lg">{value}</MonoNumber>
    </div>
  );
}

/**
 * Phase 35.1 — guided End-of-Day Closing Wizard.
 * Orchestrates existing preflight / count / PIN / recordDayClose — no ledger rewrite.
 */
export function EndOfDayClosingWizard({ lang, session }: Props) {
  const [step, setStep] = useState<EodWizardStepId>(() =>
    typeof window !== "undefined" && window.location.hash === "#cash-count" ? "cash" : "start",
  );
  const [submitting, setSubmitting] = useState(false);

  const {
    closeDateKey,
    todayKey,
    unclosedPriorDays,
    oldestUnclosedPriorDay,
    setCloseDateKey,
    counted,
    setCounted,
    countedN,
    varianceFlagged,
    summary,
    tenderReport,
    preflight,
    preflightLoading,
    refreshPreflightWithSync,
    syncOverride,
    setSyncOverride,
    managerPin,
    setManagerPin,
    needsManagerPin,
    sessionCanApproveWithoutPin,
    canSubmitNormal,
    preferences,
    submitClose,
    closeErrorKey,
    activeCloseToday,
    doneMsg,
    last,
    shopName,
    emergencyMode,
    setEmergencyMode,
    emergencyReason,
    setEmergencyReason,
    submitEmergency,
  } = session;

  const blockingFails = useMemo(
    () => (preflight?.items ?? []).filter((i) => i.status === "fail" && i.blockClose),
    [preflight],
  );
  const warnings = useMemo(
    () => (preflight?.items ?? []).filter((i) => i.status === "warn" || (i.status === "fail" && !i.blockClose)),
    [preflight],
  );
  const preflightRailItems = useMemo(() => {
    const items = (preflight?.items ?? []).filter((i) => i.id !== "ready");
    const head = items.slice(0, 6);
    const cash = items.find((i) => i.id === "cash_counted");
    if (cash && !head.some((i) => i.id === "cash_counted")) {
      return [...head.slice(0, 5), cash];
    }
    return head;
  }, [preflight]);

  const goNext = () => {
    if (step === "cash" && !eodWizardCanLeaveCashStep(counted)) return;
    const next = eodWizardNextStep(step);
    if (next) setStep(next);
  };

  const goBack = () => {
    const prev = eodWizardPrevStep(step);
    if (prev) setStep(prev);
  };

  const onConfirmClose = async () => {
    setSubmitting(true);
    const ok = emergencyMode ? await submitEmergency() : await submitClose();
    setSubmitting(false);
    if (ok) setStep("start");
  };

  const stepReady = (id: EodWizardStepId): boolean => {
    if (id === "summary" || id === "reports" || id === "review") {
      return eodWizardCanLeaveCashStep(counted) || Boolean(activeCloseToday);
    }
    return true;
  };

  const primaryDisabled =
    step === "cash"
      ? !eodWizardCanLeaveCashStep(counted)
      : step === "review"
        ? Boolean(activeCloseToday) ||
          submitting ||
          (emergencyMode
            ? !emergencyReason.trim() ||
              (!sessionCanApproveWithoutPin && managerPin.trim().length === 0)
            : !canSubmitNormal)
        : false;

  const primaryLabel =
    step === "review"
      ? emergencyMode
        ? t(lang, "dayCloseEmergencyConfirm")
        : t(lang, "closeConfirm")
      : t(lang, "eodWizardNext");

  const onPrimary = () => {
    if (step === "review") {
      void onConfirmClose();
      return;
    }
    goNext();
  };

  return (
    <div className="eod-closing-wizard flex min-h-0 flex-col gap-4 lg:grid lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] lg:items-start lg:gap-5">
      {/* Desktop checklist rail / mobile step chips */}
      <aside className="lg:sticky lg:top-3">
        <EnterpriseCard className="!p-3" title={t(lang, "eodWizardChecklistTitle")}>
          <ol className="mt-2 space-y-1.5" aria-label={t(lang, "eodWizardChecklistTitle")}>
            {EOD_WIZARD_STEP_META.map((meta, index) => {
              const active = meta.id === step;
              const done = EOD_WIZARD_STEP_META.findIndex((m) => m.id === step) > index;
              const locked = !stepReady(meta.id) && !done && !active;
              return (
                <li key={meta.id}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (!locked) setStep(meta.id);
                    }}
                    className={clsx(
                      "flex w-full min-h-[44px] items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-bold transition-colors",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500",
                      active && "bg-waka-100 text-waka-950 ring-1 ring-waka-300",
                      done && !active && "bg-emerald-50 text-emerald-950",
                      !active && !done && "bg-muted/60 text-muted-foreground",
                      locked && "opacity-40",
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-xs font-black">
                      {done ? <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t(lang, meta.titleKey)}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {preflight ? (
            <div className="mt-3 border-t border-border pt-3">
              <Caption className="normal-case">{t(lang, "eodWizardPreflightShort")}</Caption>
              <ul className="mt-1.5 space-y-1">
                {preflightRailItems.map((item) => {
                  const cashLink =
                    item.id === "cash_counted" && item.navigateTo && item.status !== "pass";
                  return (
                    <li key={item.id} className="flex items-center gap-1.5 text-[11px] font-semibold">
                      {item.status === "pass" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                      ) : (
                        <Circle
                          className={clsx(
                            "h-3.5 w-3.5",
                            item.status === "fail" ? "text-rose-600" : "text-amber-600",
                          )}
                          aria-hidden
                        />
                      )}
                      {cashLink ? (
                        <Link
                          to={item.navigateTo!}
                          className="min-w-0 flex-1 truncate text-waka-800 underline"
                        >
                          {t(lang, item.labelKey)}
                        </Link>
                      ) : (
                        <span className="truncate text-muted-foreground">{t(lang, item.labelKey)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </EnterpriseCard>
      </aside>

      <div className="min-w-0 space-y-4">
        <header className="rounded-2xl border border-border bg-card px-4 py-3">
          <SectionTitle as="h2" className="!text-base sm:!text-lg">
            {t(lang, EOD_WIZARD_STEP_META.find((m) => m.id === step)!.titleKey)}
          </SectionTitle>
          <Caption className="mt-0.5 normal-case">
            {t(lang, EOD_WIZARD_STEP_META.find((m) => m.id === step)!.hintKey)}
          </Caption>
          <p className="mt-2 text-sm font-bold text-foreground">
            {t(lang, "dayCloseBusinessDate")}: {closeDateKey}
            {closeDateKey !== todayKey ? (
              <span className="ml-2 text-amber-800">
                ({tTemplate(lang, "closeDayPriorBanner", { date: closeDateKey, today: todayKey })})
              </span>
            ) : null}
          </p>
        </header>

        {activeCloseToday ? (
          <EnterpriseCard className="!p-4 border-emerald-200 bg-emerald-50">
            <p className="text-base font-black text-emerald-950">{t(lang, "eodWizardAlreadyClosed")}</p>
            {last && last.dateKey === closeDateKey ? (
              <div className="mt-3">
                <DocumentActionsBar
                  lang={lang}
                  compact
                  onPrint={() => void printDayCloseReport(lang, last, shopName)}
                  onDownloadPdf={() =>
                    void downloadDayClosePdf(lang, last, shopName).then(
                      (ok) => !ok && window.alert(t(lang, "receiptPdfFailed")),
                    )
                  }
                  onSharePdf={() =>
                    void shareDayClosePdf(lang, last, shopName).then(
                      (ok) => !ok && window.alert(t(lang, "receiptPdfFailed")),
                    )
                  }
                />
              </div>
            ) : null}
          </EnterpriseCard>
        ) : null}

        {doneMsg ? (
          <p className="rounded-2xl bg-foreground px-4 py-3 text-center text-lg font-bold text-background">
            {t(lang, "closeSaved")}
          </p>
        ) : null}

        {/* Step bodies */}
        {step === "start" ? (
          <div className="space-y-3">
            <EnterpriseCard className="!p-4">
              <p className="text-sm font-semibold text-muted-foreground">{t(lang, "eodWizardStartBody")}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm font-bold text-foreground">
                <li>{t(lang, "eodWizardStepHealth")}</li>
                <li>{t(lang, "eodWizardStepCash")}</li>
                <li>{t(lang, "eodWizardStepSummary")}</li>
                <li>{t(lang, "eodWizardStepReports")}</li>
                <li>{t(lang, "eodWizardStepReview")}</li>
              </ol>
            </EnterpriseCard>
            {unclosedPriorDays.length > 0 ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase text-amber-800">{t(lang, "closeDayPriorPicker")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {unclosedPriorDays.map((dk) => (
                    <button
                      key={dk}
                      type="button"
                      disabled={oldestUnclosedPriorDay != null && dk !== oldestUnclosedPriorDay}
                      onClick={() => setCloseDateKey(dk)}
                      className={
                        dk === closeDateKey
                          ? "min-h-[44px] rounded-xl bg-waka-600 px-3 py-2 text-sm font-black text-white disabled:opacity-60"
                          : "min-h-[44px] rounded-xl border border-amber-300 bg-card px-3 py-2 text-sm font-bold text-amber-950 disabled:opacity-40"
                      }
                    >
                      {dk}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {step === "health" ? (
          <div className="space-y-3">
            <HomeBusinessHealthSection lang={lang} />
            <CloseDayPreflightPanel lang={lang} snapshot={preflight} loading={preflightLoading} />
            {preflight?.requiresSyncOverride ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-base font-black text-amber-950">{t(lang, "dayCloseSyncOverrideTitle")}</h3>
                <p className="mt-1 text-sm font-semibold text-amber-900">{t(lang, "dayCloseSyncOverrideBody")}</p>
                <button
                  type="button"
                  disabled={preflightLoading}
                  onClick={() => void refreshPreflightWithSync()}
                  className="mt-3 min-h-[44px] rounded-2xl border border-amber-300 bg-card px-4 text-sm font-black text-amber-950 disabled:opacity-50"
                >
                  {preflightLoading ? t(lang, "dayClosePreflightLoading") : t(lang, "dayCloseSyncRetryBtn")}
                </button>
                <WakaSwitch
                  className="mt-3 text-sm font-semibold text-amber-900"
                  checked={syncOverride}
                  onCheckedChange={setSyncOverride}
                  label={t(lang, "dayCloseCheckCloudSyncFail")}
                />
              </section>
            ) : null}
            {blockingFails.length > 0 ? (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">
                {tTemplate(lang, "eodWizardBlockingCount", { count: String(blockingFails.length) })}
              </p>
            ) : (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
                {t(lang, "eodWizardHealthClear")}
              </p>
            )}
          </div>
        ) : null}

        {step === "cash" ? (
          <div className="space-y-3" id="cash-count">
            <EnterpriseCard className="!p-4">
              <p className="text-[11px] font-black uppercase text-muted-foreground">{t(lang, "closeDayExpectedTitle")}</p>
              <MonoNumber className="mt-1 text-2xl">UGX {summary.expectedCash.toLocaleString()}</MonoNumber>
              <label className="mt-4 block text-base font-black text-foreground">{t(lang, "closeCountedCash")}</label>
              <input
                value={counted}
                onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}
                inputMode="numeric"
                className="mt-2 w-full rounded-2xl border-2 border-waka-300 bg-card px-4 py-4 text-3xl font-black"
                placeholder="0"
                aria-label={t(lang, "closeCountedCash")}
              />
              {counted.length > 0 ? (
                <CashVarianceSummary
                  lang={lang}
                  expectedCashUgx={summary.expectedCash}
                  countedCashUgx={countedN}
                  preferences={preferences}
                  context="day_close"
                  showSettingsLink
                  diagnosticEvent="day_close_preview"
                  className="mt-4"
                />
              ) : null}
            </EnterpriseCard>

            <EnterpriseCard className="!p-4" title={t(lang, "eodTenderTitle")} subtitle={t(lang, "eodTenderSub")}>
              <ul className="mt-2 space-y-2">
                {tenderReport.paymentMethods.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm"
                  >
                    <span className="font-bold text-foreground">
                      {t(lang, TENDER_LABEL[row.key] ?? "eodTenderReportedOther")}
                      {row.key === "cash" ? (
                        <span className="ml-2 rounded-full bg-waka-100 px-2 py-0.5 text-[10px] font-black text-waka-900">
                          {t(lang, "eodTenderCountedBadge")}
                        </span>
                      ) : (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                          {t(lang, "eodTenderReportedBadge")}
                        </span>
                      )}
                    </span>
                    <span className="font-black tabular-nums">UGX {row.amountUgx.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">{t(lang, "eodTenderFutureNote")}</p>
            </EnterpriseCard>
          </div>
        ) : null}

        {step === "summary" ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <SummaryStat label={t(lang, "totalSales")} value={`UGX ${summary.total.toLocaleString()}`} />
            <SummaryStat label={t(lang, "eodSummaryTransactions")} value={String(summary.saleCount)} />
            <SummaryStat label={t(lang, "dayCloseRefunds")} value={`UGX ${summary.refundsUgx.toLocaleString()}`} />
            <SummaryStat label={t(lang, "eodSummaryExpenses")} value={`UGX ${summary.expenseUgx.toLocaleString()}`} />
            <SummaryStat
              label={t(lang, "shiftCloseOpeningFloat")}
              value={`UGX ${summary.openingFloatUgx.toLocaleString()}`}
            />
            <SummaryStat
              label={t(lang, "eodSummaryCashIn")}
              value={`UGX ${summary.adjustmentInflowsUgx.toLocaleString()}`}
            />
            <SummaryStat
              label={t(lang, "eodSummaryCashOut")}
              value={`UGX ${summary.adjustmentOutflowsUgx.toLocaleString()}`}
            />
            <SummaryStat
              label={t(lang, "closeDayExpectedTitle")}
              value={`UGX ${summary.expectedCash.toLocaleString()}`}
            />
            <div className="col-span-2">
              <SummaryStat label={t(lang, "closeCountedCash")} value={`UGX ${countedN.toLocaleString()}`} />
            </div>
            {counted.length > 0 ? (
              <div className="col-span-2">
                <CashVarianceSummary
                  lang={lang}
                  expectedCashUgx={summary.expectedCash}
                  countedCashUgx={countedN}
                  preferences={preferences}
                  context="day_close"
                  className="mt-0"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "reports" ? (
          <div className="space-y-3">
            <EnterpriseCard className="!p-4">
              <SectionTitle as="h3" className="!text-sm">
                {t(lang, "eodReportsPreviewTitle")}
              </SectionTitle>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "eodReportsPreviewBody")}</p>
              <ul className="mt-3 space-y-2 text-sm font-bold">
                <li className="flex justify-between rounded-xl bg-muted px-3 py-2">
                  <span>{t(lang, "dayCloseXReportBtn")}</span>
                  <Link to="/office/x-report" className="text-waka-800 underline">
                    {t(lang, "eodOpenLink")}
                  </Link>
                </li>
                <li className="flex justify-between rounded-xl bg-muted px-3 py-2">
                  <span>{t(lang, "eodDailySummaryLabel")}</span>
                  <span className="tabular-nums">UGX {summary.total.toLocaleString()}</span>
                </li>
                <li className="flex justify-between rounded-xl bg-muted px-3 py-2">
                  <span>{t(lang, "eodShiftSummaryLabel")}</span>
                  <span className="tabular-nums">{summary.saleCount} txn</span>
                </li>
              </ul>
              <p className="mt-3 text-xs font-semibold text-muted-foreground">{t(lang, "closeDayTrustNote")}</p>
            </EnterpriseCard>
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-3">
            <EnterpriseCard className="!p-4 border-waka-200 bg-waka-50/50">
              <SectionTitle as="h3" className="!text-base">
                {t(lang, "eodReviewReadyTitle")}
              </SectionTitle>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <SummaryStat label={t(lang, "closeDayExpectedTitle")} value={`UGX ${summary.expectedCash.toLocaleString()}`} />
                <SummaryStat label={t(lang, "closeCountedCash")} value={`UGX ${countedN.toLocaleString()}`} />
              </div>
              {varianceFlagged ? (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
                  {t(lang, "eodReviewVarianceFlagged")}
                </p>
              ) : (
                <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
                  {t(lang, "eodReviewVarianceOk")}
                </p>
              )}
              {warnings.length > 0 ? (
                <p className="mt-2 text-xs font-semibold text-amber-900">
                  {tTemplate(lang, "eodReviewWarnings", { count: String(warnings.length) })}
                </p>
              ) : null}
            </EnterpriseCard>

            {(needsManagerPin || (Boolean(preflight?.requiresSyncOverride) && syncOverride)) &&
            !sessionCanApproveWithoutPin ? (
              <section className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-bold text-foreground">{t(lang, "dayCloseVariancePinLabel")}</p>
                <EnterpriseApprovalPinPad
                  lang={lang}
                  preferences={preferences}
                  persistOnSuccess
                  className="mt-2"
                  onApproved={(pin) => setManagerPin(pin)}
                />
                {managerPin.trim().length > 0 ? (
                  <p className="mt-2 text-center text-sm font-bold text-emerald-700">{t(lang, "staffPinCaptured")}</p>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
              <h3 className="text-base font-black text-rose-950">{t(lang, "dayCloseEmergencyTitle")}</h3>
              <p className="mt-1 text-xs font-semibold text-rose-900">{t(lang, "dayCloseEmergencyWarning")}</p>
              <WakaSwitch
                className="mt-3 text-sm font-bold text-rose-950"
                checked={emergencyMode}
                onCheckedChange={setEmergencyMode}
                label={t(lang, "dayCloseEmergencyConfirm")}
              />
              {emergencyMode ? (
                <textarea
                  value={emergencyReason}
                  onChange={(e) => setEmergencyReason(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-rose-300 px-3 py-2 text-sm"
                  rows={2}
                  placeholder={t(lang, "dayCloseEmergencyReason")}
                />
              ) : null}
            </section>

            {closeErrorKey ? (
              <p className="text-center text-sm font-bold text-red-700">
                {(t as (l: Language, k: string) => string)(lang, closeErrorKey)}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Sticky actions */}
        <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-card/95 px-1 py-3 backdrop-blur-sm supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={step === "start"}
              className="inline-flex min-h-[52px] flex-1 items-center justify-center gap-1 rounded-2xl border-2 border-border bg-card px-3 text-sm font-black disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t(lang, "eodWizardBack")}
            </button>
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled || Boolean(activeCloseToday && step === "review")}
              className="inline-flex min-h-[52px] flex-[1.4] items-center justify-center gap-1 rounded-2xl bg-waka-600 px-3 text-sm font-black text-white disabled:opacity-40 sm:text-base"
            >
              {primaryLabel}
              {step !== "review" ? <ChevronRight className="h-4 w-4" aria-hidden /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
