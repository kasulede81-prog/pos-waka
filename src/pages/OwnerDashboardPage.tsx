import { useMemo, useState } from "react";
import { useMarkOwnerRisksReviewed } from "../hooks/useMarkOwnerRisksReviewed";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { useDeferredReportingAuditLogs } from "../hooks/useDeferredReportingAuditLogs";
import { IncludeArchivedFilter } from "../components/office/IncludeArchivedFilter";
import { PageBackBar } from "../components/layout/PageBackBar";
import { Building2 } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { buildOwnerDashboardData, buildOwnerSummaryLines } from "../lib/ownerDashboardData";
import { useDrawerCashForToday } from "../hooks/useDrawerCashForDay";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { dateKeyKampala } from "../lib/datesUg";
import { buildOwnerStaffPerformanceRows } from "../lib/ownerStaffMetrics";
import { canRecordCashExpenses } from "../lib/cashExpenses";
import { useSessionActor } from "../context/SessionActorContext";
import { OwnerNeedsAttentionSection } from "../components/owner/OwnerNeedsAttentionSection";
import { OwnerBusinessTodaySection } from "../components/owner/OwnerBusinessTodaySection";
import { OwnerStaffPerformanceSection } from "../components/owner/OwnerStaffPerformanceSection";
import { OwnerInventoryHealthSection } from "../components/owner/OwnerInventoryHealthSection";
import { OwnerQuickActionsRow } from "../components/owner/OwnerQuickActionsRow";

function pulseLabel(lang: Language, pulse: ReturnType<typeof buildOwnerDashboardData>["pulse"]): string {
  if (pulse === "strong") return t(lang, "ownerPulseStrong");
  if (pulse === "steady") return t(lang, "ownerPulseSteady");
  return t(lang, "ownerPulseWatch");
}

export function OwnerDashboardPage({ lang }: { lang: Language }) {
  useMarkOwnerRisksReviewed();
  const actor = useSessionActor();
  const [includeArchived, setIncludeArchived] = useState(false);
  const sales = useDeferredReportingSales(includeArchived);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const dayCloses = usePosStore((s) => s.dayCloses);
  const preferences = usePosStore((s) => s.preferences);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const auditLogs = useDeferredReportingAuditLogs(includeArchived);
  const voidRecords = usePosStore((s) => s.voidRecords);
  const archivedVoidRecords = usePosStore((s) => s.archivedVoidRecords);
  const returnRecords = usePosStore((s) => s.returnRecords);
  const archivedReturnRecords = usePosStore((s) => s.archivedReturnRecords);
  const reportingVoidRecords = includeArchived ? [...voidRecords, ...archivedVoidRecords] : voidRecords;
  const reportingReturnRecords = includeArchived ? [...returnRecords, ...archivedReturnRecords] : returnRecords;
  const drawerToday = useDrawerCashForToday();

  const dashboard = useMemo(
    () =>
      buildOwnerDashboardData({
        lang,
        sales,
        products,
        auditLogs,
        returnRecords: reportingReturnRecords,
        voidRecords: reportingVoidRecords,
        dayCloses,
        preferences,
        drawerToday,
        hospitalityMode,
        pharmacyMode,
      }),
    [
      lang,
      sales,
      products,
      auditLogs,
      reportingReturnRecords,
      reportingVoidRecords,
      dayCloses,
      preferences,
      drawerToday,
      hospitalityMode,
      pharmacyMode,
    ],
  );

  const { summaryLines, waLine, trendLine } = useMemo(
    () => buildOwnerSummaryLines(lang, dashboard),
    [lang, dashboard],
  );

  const { stats, fastMovers, cashierPerf, lowStock, trustRows, pulse, riskCards, todayKey } = dashboard;

  const todayAuditLogs = useMemo(
    () => auditLogs.filter((e) => dateKeyKampala(e.at) === todayKey),
    [auditLogs, todayKey],
  );

  const staffRows = useMemo(
    () => buildOwnerStaffPerformanceRows(lang, trustRows, cashierPerf, todayAuditLogs),
    [lang, trustRows, cashierPerf, todayAuditLogs],
  );

  const totalDebtUgx = useMemo(
    () => customers.reduce((a, c) => a + c.debtBalanceUgx, 0),
    [customers],
  );

  const showRecordExpense = canRecordCashExpenses(actor.role, preferences);

  return (
    <div className="space-y-4 pb-12">
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

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <OwnerNeedsAttentionSection lang={lang} cards={riskCards} todayKey={todayKey} />

        <OwnerBusinessTodaySection
          lang={lang}
          stats={stats}
          trendLine={trendLine}
          pulseLabel={pulseLabel(lang, pulse)}
          customersCount={customers.length}
          totalDebtUgx={totalDebtUgx}
          fastMovers={fastMovers}
          summaryLines={summaryLines}
          waLine={waLine}
        />
      </div>

      <OwnerStaffPerformanceSection lang={lang} rows={staffRows} todayKey={todayKey} />

      <OwnerInventoryHealthSection lang={lang} lowStock={lowStock} fastMovers={fastMovers} />

      <OwnerQuickActionsRow lang={lang} showRecordExpense={showRecordExpense} />
    </div>
  );
}
