import { ShieldCheck } from "lucide-react";
import type { Language, ReturnRecord } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { actorDisplayLabel } from "../../../lib/activityNarrative";
import type { RefundIntegrityReport } from "../../../lib/auditRefundIntegrity";

type Props = {
  lang: Language;
  integrityReport: RefundIntegrityReport;
  returns: ReturnRecord[];
  onTraceReturn: (record: ReturnRecord) => void;
};

export function InvestigationRefundsSection({ lang, integrityReport, returns, onTraceReturn }: Props) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black text-foreground">{t(lang, "refundIntegrityTitle")}</h2>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "refundIntegritySub")}</p>
            <p className={`mt-2 text-sm font-bold ${integrityReport.ok ? "text-emerald-800" : "text-rose-800"}`}>
              {integrityReport.ok
                ? t(lang, "refundIntegrityOk")
                : tTemplate(lang, "refundIntegrityViolations", {
                    count: String(integrityReport.violations.length),
                  })}
            </p>
            {!integrityReport.ok ? (
              <ul className="mt-2 space-y-1 text-xs font-semibold text-rose-900">
                {integrityReport.violations.slice(0, 8).map((v, i) => (
                  <li key={`${v.code}-${i}`} className="rounded-lg bg-rose-50 px-2 py-1">
                    {v.message}
                    {v.saleId ? ` · ${v.saleId.slice(0, 8)}` : ""}
                    {v.expected != null && v.actual != null ? ` (${v.actual} / max ${v.expected})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{t(lang, "refundHistoryTitle")}</h2>
        {returns.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t(lang, "refundHistoryEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {returns.map((r) => {
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
        )}
      </section>
    </div>
  );
}
