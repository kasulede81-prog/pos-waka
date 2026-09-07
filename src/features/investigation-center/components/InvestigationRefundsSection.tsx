import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { EnterpriseListFooter } from "../../../components/enterprise/EnterpriseListFooter";
import type { Language, ReturnRecord } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { actorDisplayLabel } from "../../../lib/activityNarrative";
import type { RefundIntegrityReport } from "../../../lib/auditRefundIntegrity";
import { investigationRefundsTabHintKey } from "../lib/investigationRefundAuthority";
import { investigationRefundIntegrityPresentation } from "../lib/investigationSalesDependentReadiness";
import {
  INVESTIGATION_INTEGRITY_PAGE_SIZE,
  INVESTIGATION_RETURNS_PAGE_SIZE,
  nextInvestigationVisibleCount,
  paginateInvestigationResults,
  resetInvestigationVisibleCount,
} from "../lib/investigationResultScope";

type Props = {
  lang: Language;
  integrityReport: RefundIntegrityReport;
  salesDependentReady?: boolean;
  returns: ReturnRecord[];
  onTraceReturn: (record: ReturnRecord) => void;
};

export function InvestigationRefundsSection({
  lang,
  integrityReport,
  salesDependentReady = true,
  returns,
  onTraceReturn,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(INVESTIGATION_RETURNS_PAGE_SIZE);
  const [integrityVisibleCount, setIntegrityVisibleCount] = useState(INVESTIGATION_INTEGRITY_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(resetInvestigationVisibleCount(INVESTIGATION_RETURNS_PAGE_SIZE));
  }, [returns]);
  useEffect(() => {
    setIntegrityVisibleCount(resetInvestigationVisibleCount(INVESTIGATION_INTEGRITY_PAGE_SIZE));
  }, [integrityReport.violations]);
  const page = useMemo(
    () => paginateInvestigationResults(returns, visibleCount),
    [returns, visibleCount],
  );
  const integrityPage = useMemo(
    () => paginateInvestigationResults(integrityReport.violations, integrityVisibleCount),
    [integrityReport.violations, integrityVisibleCount],
  );
  const integrityPresentation = investigationRefundIntegrityPresentation(salesDependentReady);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black text-foreground">{t(lang, "refundIntegrityTitle")}</h2>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "refundIntegritySub")}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-emerald-900/80">
              {t(lang, "refundIntegrityScopeGlobal")}
            </p>
            {integrityPresentation === "loading" ? (
              <p className="mt-2 text-sm font-bold text-muted-foreground" role="status" aria-live="polite" aria-busy="true">
                {t(lang, "icRefundIntegrityLoading")}
              </p>
            ) : (
            <p className={`mt-2 text-sm font-bold ${integrityReport.ok ? "text-emerald-800" : "text-rose-800"}`}>
              {integrityReport.ok
                ? t(lang, "refundIntegrityOk")
                : tTemplate(lang, "refundIntegrityViolations", {
                    count: String(integrityReport.violations.length),
                  })}
            </p>
            )}
            {integrityPresentation === "ready" && !integrityReport.ok ? (
              <>
              <ul className="mt-2 space-y-1 text-xs font-semibold text-rose-900">
                {integrityPage.displayed.map((v, i) => (
                  <li key={`${v.code}-${i}`} className="rounded-lg bg-rose-50 px-2 py-1">
                    {v.message}
                    {v.saleId ? ` · ${v.saleId.slice(0, 8)}` : ""}
                    {v.expected != null && v.actual != null ? ` (${v.actual} / max ${v.expected})` : ""}
                  </li>
                ))}
              </ul>
              {integrityPage.hasMore || integrityPage.total > INVESTIGATION_INTEGRITY_PAGE_SIZE ? (
                <EnterpriseListFooter
                  lang={lang}
                  truncated={integrityPage.hasMore}
                  truncatedCount={integrityPage.shown}
                  totalCount={integrityPage.total}
                  hasMore={integrityPage.hasMore}
                  onLoadMore={() =>
                    setIntegrityVisibleCount((current) =>
                      nextInvestigationVisibleCount(current, integrityPage.total, INVESTIGATION_INTEGRITY_PAGE_SIZE),
                    )
                  }
                  endOfList={!integrityPage.hasMore && integrityPage.total > INVESTIGATION_INTEGRITY_PAGE_SIZE}
                />
              ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t(lang, "refundHistoryTitle")}</h2>
        <p className="mt-1 text-[10px] font-medium text-muted-foreground">{t(lang, "refundHistoryRangeScoped")}</p>
        <p className="mt-1 text-[10px] font-medium text-muted-foreground">{t(lang, investigationRefundsTabHintKey())}</p>
        {page.total === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t(lang, "refundHistoryEmpty")}</p>
        ) : (
          <>
          <ul className="mt-3 space-y-2">
            {page.displayed.map((r) => {
              const staff = r.actorName?.trim() || actorDisplayLabel(r.actorUserId, lang);
              const when = new Date(r.createdAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-foreground">
                      {r.productName} · UGX {r.refundAmountUgx.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {staff} · {when}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTraceReturn(r)}
                    className="shrink-0 rounded-xl border border-waka-200 bg-waka-50 px-3 py-1.5 text-xs font-black text-waka-900"
                  >
                    {t(lang, "refundTraceView")}
                  </button>
                </li>
              );
            })}
          </ul>
          {page.hasMore || page.total > INVESTIGATION_RETURNS_PAGE_SIZE ? (
          <EnterpriseListFooter
            lang={lang}
            truncated={page.hasMore}
            truncatedCount={page.shown}
            totalCount={page.total}
            hasMore={page.hasMore}
            onLoadMore={() =>
              setVisibleCount((current) =>
                nextInvestigationVisibleCount(current, page.total, INVESTIGATION_RETURNS_PAGE_SIZE),
              )
            }
            endOfList={!page.hasMore && page.total > INVESTIGATION_RETURNS_PAGE_SIZE}
          />
          ) : null}
          </>
        )}
      </section>
    </div>
  );
}
