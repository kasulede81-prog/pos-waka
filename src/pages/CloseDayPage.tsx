import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Banknote, CalendarCheck } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { actorHasPermission } from "../lib/actorAuthorization";
import { dateMatchesFilter, resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";
import { PageHeader } from "../components/layout/PageHeader";
import { EnterpriseApprovalPinPad } from "../components/auth/EnterpriseApprovalPinPad";
import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";
import { HistoryListCard } from "../components/shared/HistoryListCard";
import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";
import { downloadDayClosePdf, printDayCloseReport, shareDayClosePdf } from "../lib/dayCloseDocument";
import { EndOfDayClosingWizard } from "../components/eod/EndOfDayClosingWizard";
import { useEndOfDayCloseSession } from "../hooks/useEndOfDayCloseSession";
import { dayCloseCashCountHref } from "../lib/dayCloseEnforcement";

/**
 * Phase 35.1 — Close Day hosts the guided End-of-Day wizard.
 * History / reopen remain on this page; ledger APIs unchanged.
 */
export function CloseDayPage({ lang }: { lang: Language }) {
  const session = useEndOfDayCloseSession(lang);
  const [historyFilter, setHistoryFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });

  const historyBounds = useMemo(() => resolveDateFilterBounds(historyFilter), [historyFilter]);
  const filteredDayCloses = useMemo(
    () => session.dayCloses.filter((d) => dateMatchesFilter(d.dateKey, historyBounds)),
    [session.dayCloses, historyBounds],
  );

  const pct = session.preferences.cashVarianceThresholdPct ?? 5;
  const fixed = session.preferences.cashVarianceThresholdUgxFixed ?? 10_000;
  const closeVarianceFlag = (expected: number, diff: number) => {
    const exp = Math.max(1, expected);
    return Math.abs(diff) > Math.max((pct / 100) * exp, fixed);
  };

  const historySummary = useMemo(() => {
    let profit = 0;
    let varianceCount = 0;
    for (const d of filteredDayCloses) {
      profit += d.profitEstimateUgx;
      if (closeVarianceFlag(d.expectedCashUgx, d.differenceUgx)) varianceCount += 1;
    }
    return { count: filteredDayCloses.length, profit, varianceCount };
  }, [filteredDayCloses, pct, fixed]);

  if (!session.canAccess) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader lang={lang} title={t(lang, "closeDay")} backLabel={t(lang, "officeBackToHub")} />
        <p className="text-lg text-muted-foreground">{t(lang, "noPermission")}</p>
      </div>
    );
  }

  const {
    actor,
    preferences,
    shopName,
    closeDateKey,
    activeCloseToday,
    last,
    dayReopenHistory,
    reopenReason,
    setReopenReason,
    reopenBusinessDay,
    setCloseErrorKey,
    closeErrorKey,
    refreshPreflightWithSync,
  } = session;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "eodWizardPageTitle")}
        subtitle={t(lang, "eodWizardPageSub")}
        backLabel={t(lang, "officeBackToHub")}
        backFallback="/office/cash-drawer"
      />

      <div className="flex flex-wrap gap-2">
        <Link
          to="/office/x-report"
          className="min-h-[44px] rounded-2xl border border-border bg-card px-4 py-2 text-sm font-black text-waka-800"
        >
          {t(lang, "dayCloseXReportBtn")}
        </Link>
        <Link
          to={dayCloseCashCountHref(closeDateKey)}
          className="min-h-[44px] rounded-2xl border border-border bg-card px-4 py-2 text-sm font-black text-waka-800"
        >
          {t(lang, "eodOpenCashPosition")}
        </Link>
      </div>

      <EndOfDayClosingWizard lang={lang} session={session} />

      {activeCloseToday && actor.role === "owner" ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-base font-black text-amber-950">{t(lang, "dayCloseReopenTitle")}</h2>
          <input
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder={t(lang, "dayCloseReopenReason")}
            className="mt-3 w-full rounded-xl border border-amber-300 px-3 py-2 text-sm"
          />
          <EnterpriseApprovalPinPad
            lang={lang}
            preferences={preferences}
            disabled={!reopenReason.trim()}
            className="mt-3"
            onApproved={async (pin) => {
              setCloseErrorKey(null);
              const result = await reopenBusinessDay({
                dateKey: closeDateKey,
                reason: reopenReason,
                ownerPin: pin,
              });
              if (!result.ok) {
                setCloseErrorKey(result.errorKey ?? "invalid");
                return false;
              }
              setReopenReason("");
              void refreshPreflightWithSync();
              return true;
            }}
          />
          {closeErrorKey ? (
            <p className="mt-2 text-center text-sm font-bold text-red-700">
              {(t as (l: Language, k: string) => string)(lang, closeErrorKey)}
            </p>
          ) : null}
        </section>
      ) : null}

      {dayReopenHistory.length > 0 ? (
        <section className="rounded-3xl border border-border bg-card p-4">
          <h2 className="text-base font-black text-foreground">{t(lang, "dayCloseReopenHistory")}</h2>
          <ul className="mt-2 space-y-2">
            {dayReopenHistory.slice(0, 10).map((r) => (
              <li key={r.id} className="text-xs font-semibold text-muted-foreground">
                {r.dateKey} · {r.reopenedByLabel} · {r.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {last && last.dateKey === closeDateKey && activeCloseToday ? (
        <section className="rounded-3xl border-2 border-border bg-muted p-5">
          <DocumentActionsBar
            lang={lang}
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
          <p className="mt-4 text-lg font-black text-foreground">{t(lang, "closeLastDiff")}</p>
          <p className="mt-2 text-3xl font-black text-foreground">UGX {last.differenceUgx.toLocaleString()}</p>
        </section>
      ) : null}

      {actorHasPermission(actor, "owner.cash_history") ? (
        <section className="space-y-4">
          <h2 className="text-xl font-black text-foreground">{t(lang, "closeHistoryTitle")}</h2>
          <HistoryHeroCard
            lang={lang}
            filter={historyFilter}
            onFilterChange={setHistoryFilter}
            metrics={[
              { label: t(lang, "closeHistoryTitle"), icon: CalendarCheck, value: String(historySummary.count) },
              {
                label: t(lang, "closeHistoryProfit"),
                icon: Banknote,
                value: `UGX ${historySummary.profit.toLocaleString()}`,
              },
              {
                label: t(lang, "ownerVarianceFlag"),
                icon: AlertTriangle,
                value: String(historySummary.varianceCount),
              },
            ]}
          />
          <HistoryListCard
            isEmpty={filteredDayCloses.length === 0}
            empty={<p className="text-sm font-semibold text-muted-foreground">{t(lang, "closeHistoryTitle")}</p>}
          >
            <ul>
              {filteredDayCloses.slice(0, 20).map((d) => (
                <li key={d.id} className="border-b border-border px-3 py-3 last:border-b-0">
                  <p className="text-sm font-black text-foreground">{d.dateKey}</p>
                  <p className="text-xs text-muted-foreground">
                    UGX {d.expectedCashUgx.toLocaleString()} / {d.countedCashUgx.toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </HistoryListCard>
        </section>
      ) : null}
    </div>
  );
}
