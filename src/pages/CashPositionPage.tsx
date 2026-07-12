import { useCallback, useEffect, useRef, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Navigate } from "react-router-dom";
import type { CashDrawerAdjustmentType, Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { DEFAULT_DATE_FILTER, type DateFilterValue } from "../lib/dateFilters";
import {
  downloadCashPositionCsv,
  downloadCashPositionExcel,
  downloadCashPositionPdf,
  openCashPositionEmail,
  openCashPositionWhatsApp,
  printCashPositionReport,
  shareCashPositionPdf,
} from "../lib/cashPositionExport";
import type { CashPositionReconciliation } from "../lib/cashPosition";
import { useCashPositionDashboard } from "../hooks/useCashPositionDashboard";
import { SalesHistoryDateFilterChips } from "../components/receipts/SalesHistoryDateFilterChips";
import { CashPositionCollapsibleCard } from "../components/cash-position/CashPositionCollapsibleCard";
import {
  CashPositionActivityTimeline,
  CashPositionBreakdown,
  CashPositionDrawerStatus,
  CashPositionHeroSummary,
  CashPositionPaymentMethods,
  CashPositionQuickActions,
} from "../components/cash-position/CashPositionSections";
import {
  CashPositionAlertsPanel,
  CashPositionCashCount,
  CashPositionCashiers,
  CashPositionCategories,
  CashPositionDailyNotes,
  CashPositionExportCenter,
  CashPositionMovementForm,
  CashPositionPreviousCounts,
  CashPositionSafeLimit,
} from "../components/cash-position/CashPositionMoreSections";

export function CashPositionPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = actorHasPermission(actor, "day.close");
  const addCashDrawerAdjustment = usePosStore((s) => s.addCashDrawerAdjustment);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const [filter, setFilter] = useState<DateFilterValue>(DEFAULT_DATE_FILTER);
  const { dashboard, isStale, todayKey, preferences } = useCashPositionDashboard(lang, filter);

  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [movementType, setMovementType] = useState<CashDrawerAdjustmentType>("cash_added");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [movementMsg, setMovementMsg] = useState<string | null>(null);
  const [safeLimitInput, setSafeLimitInput] = useState(
    () => String(preferences.cashSafeLimitUgx ?? ""),
  );
  const noteDayKey = dashboard.isSingleDay ? dashboard.bounds.fromKey : todayKey;
  const [dailyNote, setDailyNote] = useState(
    () => preferences.cashPositionDayNotes?.[noteDayKey] ?? "",
  );

  useEffect(() => {
    setDailyNote(preferences.cashPositionDayNotes?.[noteDayKey] ?? "");
  }, [noteDayKey, preferences.cashPositionDayNotes]);

  const sectionRefs = {
    count: useRef<HTMLDivElement>(null),
    movements: useRef<HTMLDivElement>(null),
    export: useRef<HTMLDivElement>(null),
  };

  const scrollTo = (key: keyof typeof sectionRefs) => {
    sectionRefs[key].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const exportReconciliation: CashPositionReconciliation | null =
    dashboard.drawerStatus?.countedCashUgx != null && dashboard.drawerStatus.kind
      ? {
          physicalCountUgx: dashboard.drawerStatus.countedCashUgx,
          varianceUgx: dashboard.drawerStatus.varianceUgx ?? 0,
          varianceKind: dashboard.drawerStatus.kind,
        }
      : null;

  const showExportHint = (ok: boolean) => {
    setExportHint(ok ? t(lang, "cashPositionExportOk") : t(lang, "cashPositionExportFail"));
    window.setTimeout(() => setExportHint(null), 3500);
  };

  const runExport = useCallback(
    async (kind: "pdf" | "csv" | "excel" | "share" | "print" | "preview" | "email" | "whatsapp") => {
      setExportBusy(true);
      try {
        const report = dashboard.report;
        const recon = exportReconciliation;
        let ok = false;
        if (kind === "pdf") ok = await downloadCashPositionPdf(lang, report, recon);
        else if (kind === "csv") ok = await downloadCashPositionCsv(report, recon);
        else if (kind === "excel") ok = await downloadCashPositionExcel(report, recon);
        else if (kind === "share") ok = await shareCashPositionPdf(lang, report, recon);
        else if (kind === "email") ok = openCashPositionEmail(lang, report, recon);
        else if (kind === "whatsapp") ok = openCashPositionWhatsApp(lang, report, recon);
        else if (kind === "print" || kind === "preview") ok = await printCashPositionReport(lang, report, recon);
        showExportHint(ok);
      } finally {
        setExportBusy(false);
      }
    },
    [dashboard.report, exportReconciliation, lang],
  );

  const submitMovement = () => {
    const amountUgx = Math.floor(Number(movementAmount.replace(/\D/g, "")) || 0);
    if (amountUgx <= 0 || !movementReason.trim()) return;
    const combinedNote = movementNote.trim()
      ? `${movementReason.trim()} — ${movementNote.trim()}`
      : movementReason.trim();
    const result = addCashDrawerAdjustment({
      type: movementType,
      amountUgx,
      note: combinedNote,
    });
    if (result.ok) {
      setMovementAmount("");
      setMovementReason("");
      setMovementNote("");
      setMovementMsg(t(lang, "cashPositionMovementSaved"));
      window.setTimeout(() => setMovementMsg(null), 3000);
    }
  };

  const actorLabel = actor.displayName?.trim() || actor.role;

  if (!canView) {
    return <Navigate to="/office/cash-drawer" replace />;
  }

  return (
    <div className="space-y-4 pb-20">
      <PageHeader
        lang={lang}
        title={t(lang, "cashPositionTitle")}
        subtitle={t(lang, "cashPositionSub")}
        backFallback="/"
        backLabel={t(lang, "posNavMainMenu")}
      />

      <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
      <p className="text-sm font-semibold text-muted-foreground">
        {t(lang, "cashPositionPeriod")}:{" "}
        <span className="font-black text-foreground">{dashboard.rangeLabel}</span>
        {isStale ? (
          <span className="ml-2 text-xs font-bold text-waka-700">{t(lang, "loading")}</span>
        ) : null}
      </p>

      <CashPositionQuickActions
        lang={lang}
        onCountCash={() => scrollTo("count")}
        onAddCash={() => {
          setMovementType("cash_added");
          scrollTo("movements");
        }}
        onRemoveCash={() => {
          setMovementType("cash_removed");
          scrollTo("movements");
        }}
        onBankDeposit={() => {
          setMovementType("bank_deposit");
          scrollTo("movements");
        }}
        onExport={() => scrollTo("export")}
      />

      <CashPositionHeroSummary lang={lang} extendedSummary={dashboard.extendedSummary} rangeLabel={dashboard.rangeLabel} />

      <CashPositionCollapsibleCard id="payments" title={t(lang, "cashPositionSectionPayments")} icon="💳" defaultOpen>
        <CashPositionPaymentMethods lang={lang} report={dashboard.report} />
      </CashPositionCollapsibleCard>

      <CashPositionCollapsibleCard id="cash" title={t(lang, "cashPositionSectionCash")} icon="💵" defaultOpen>
        <CashPositionBreakdown lang={lang} report={dashboard.report} />
      </CashPositionCollapsibleCard>

      {dashboard.isSingleDay ? (
        <CashPositionCollapsibleCard id="timeline" title={t(lang, "cashPositionSectionTimeline")} icon="🧾" defaultOpen>
          <CashPositionActivityTimeline lang={lang} events={dashboard.timeline} />
        </CashPositionCollapsibleCard>
      ) : null}

      {dashboard.isToday && dashboard.drawerStatus ? (
        <CashPositionCollapsibleCard id="drawer" title={t(lang, "cashPositionSectionDrawer")} icon="⚖️" defaultOpen>
          <CashPositionDrawerStatus lang={lang} status={dashboard.drawerStatus} preferences={preferences} />
        </CashPositionCollapsibleCard>
      ) : null}

      <div ref={sectionRefs.movements}>
        <CashPositionCollapsibleCard id="movements" title={t(lang, "cashPositionRecordMovement")} icon="💸">
          <CashPositionMovementForm
            lang={lang}
            actorLabel={actorLabel}
            movementType={movementType}
            movementAmount={movementAmount}
            movementReason={movementReason}
            movementNote={movementNote}
            movementMsg={movementMsg}
            onTypeChange={setMovementType}
            onAmountChange={setMovementAmount}
            onReasonChange={setMovementReason}
            onNoteChange={setMovementNote}
            onSubmit={submitMovement}
          />
        </CashPositionCollapsibleCard>
      </div>

      <CashPositionCollapsibleCard id="categories" title={t(lang, "cashPositionSectionCategories")} icon="📦">
        <CashPositionCategories lang={lang} categories={dashboard.categories} />
      </CashPositionCollapsibleCard>

      <CashPositionCollapsibleCard id="cashiers" title={t(lang, "cashPositionSectionCashiers")} icon="👤">
        <CashPositionCashiers lang={lang} cashiers={dashboard.cashiers} />
      </CashPositionCollapsibleCard>

      {dashboard.isToday ? (
        <div ref={sectionRefs.count}>
          <CashPositionCollapsibleCard id="count" title={t(lang, "cashPositionSectionCount")} icon="💰" defaultOpen>
            <CashPositionCashCount
              lang={lang}
              expectedUgx={dashboard.report.cashPosition.expectedCashUgx}
              onUseTotal={(total) => {
                try {
                  sessionStorage.setItem("waka-close-day-prefill", String(total));
                } catch {
                  /* ignore */
                }
              }}
            />
          </CashPositionCollapsibleCard>
        </div>
      ) : null}

      {dashboard.isToday ? (
        <CashPositionCollapsibleCard id="alerts" title={t(lang, "cashPositionSectionAlerts")} icon="⚠️" defaultOpen>
          <CashPositionAlertsPanel lang={lang} alerts={dashboard.alerts} />
        </CashPositionCollapsibleCard>
      ) : null}

      {dashboard.isToday ? (
        <CashPositionCollapsibleCard id="safe" title={t(lang, "cashPositionSectionSafe")} icon="🔒">
          <CashPositionSafeLimit
            lang={lang}
            safeLimit={dashboard.safeLimit}
            limitInput={safeLimitInput}
            onLimitChange={setSafeLimitInput}
            onSaveLimit={() => {
              const n = Math.max(0, Math.floor(Number(safeLimitInput.replace(/\D/g, "")) || 0));
              setPreferences({ cashSafeLimitUgx: n > 0 ? n : null });
            }}
          />
        </CashPositionCollapsibleCard>
      ) : null}

      <CashPositionCollapsibleCard id="history" title={t(lang, "cashPositionSectionPrevious")} icon="📅">
        <CashPositionPreviousCounts lang={lang} rows={dashboard.previousCounts} />
      </CashPositionCollapsibleCard>

      <CashPositionCollapsibleCard id="notes" title={t(lang, "cashPositionSectionNotes")} icon="📝">
        <CashPositionDailyNotes
          lang={lang}
          note={dailyNote}
          onChange={setDailyNote}
          onSave={() => {
            const notes = { ...(preferences.cashPositionDayNotes ?? {}) };
            if (dailyNote.trim()) notes[noteDayKey] = dailyNote.trim();
            else delete notes[noteDayKey];
            setPreferences({ cashPositionDayNotes: notes });
          }}
        />
      </CashPositionCollapsibleCard>

      <div ref={sectionRefs.export}>
        <CashPositionCollapsibleCard id="export" title={t(lang, "cashPositionSectionExport")} icon="📤">
          <CashPositionExportCenter
            lang={lang}
            exportBusy={exportBusy}
            exportHint={exportHint}
            onPrint={() => void runExport("print")}
            onPdf={() => void runExport("pdf")}
            onCsv={() => void runExport("csv")}
            onExcel={() => void runExport("excel")}
            onShare={() => void runExport("share")}
            onEmail={() => void runExport("email")}
            onWhatsApp={() => void runExport("whatsapp")}
            onPreview={() => void runExport("preview")}
          />
        </CashPositionCollapsibleCard>
      </div>
    </div>
  );
}
