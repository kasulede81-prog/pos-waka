import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { HARD_DELETE_COUNT_LABELS, type HardDeleteVerificationReport } from "../../lib/hardDeleteReport";

type Props = {
  lang: Language;
  report: HardDeleteVerificationReport | null | undefined;
  title?: string;
};

export function HardDeleteReportPanel({ lang, report, title }: Props) {
  if (!report?.counts) return null;

  const passed = report.all_passed === true;

  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${
        passed ? "border-emerald-200 bg-emerald-50/80" : "border-amber-200 bg-amber-50/80"
      }`}
    >
      <p className="text-sm font-black text-stone-950">
        {title ?? t(lang, passed ? "hardDeleteReportPassed" : "hardDeleteReportFailed")}
      </p>
      <dl className="mt-3 space-y-1.5 text-xs">
        {HARD_DELETE_COUNT_LABELS.map(({ key, label }) => {
          const count = report.counts?.[key] ?? 0;
          return (
            <div key={key} className="flex justify-between gap-3 font-semibold">
              <dt className="text-stone-700">{label}</dt>
              <dd className={count === 0 ? "text-emerald-800" : "text-rose-800"}>{count}</dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}
