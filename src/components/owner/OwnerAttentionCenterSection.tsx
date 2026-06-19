import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { AttentionItem } from "../../lib/ownerCommandCenter";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  critical: AttentionItem[];
  warnings: AttentionItem[];
  information: AttentionItem[];
  periodLabel: string;
};

function severityClass(severity: AttentionItem["severity"]): string {
  if (severity === "critical") return "border-rose-200 bg-rose-50 text-rose-950";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-sky-200 bg-sky-50 text-sky-950";
}

function formatTs(iso: string | null | undefined, lang: Language): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function AlertGroup({
  lang,
  title,
  items,
}: {
  lang: Language;
  title: string;
  items: AttentionItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-t border-stone-100 first:border-t-0">
      <p className="px-4 pb-1 pt-3 text-[10px] font-black uppercase tracking-widest text-stone-500">{title}</p>
      <ul className="divide-y divide-stone-100">
        {items.map((item) => (
          <li key={item.id}>
            <div className={`mx-3 mb-2 rounded-2xl border px-3 py-3 ${severityClass(item.severity)}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black">
                    {item.titleVars ? tTemplate(lang, item.titleKey, item.titleVars) : t(lang, item.titleKey)}
                  </p>
                  {item.detailKey ? (
                    <p className="mt-0.5 text-xs font-semibold opacity-90">
                      {item.detailVars ? tTemplate(lang, item.detailKey, item.detailVars) : t(lang, item.detailKey)}
                    </p>
                  ) : null}
                  {item.actorLabel ? (
                    <p className="mt-1 text-xs font-semibold opacity-80">
                      {t(lang, "ownerAttentionActor")}: {item.actorLabel}
                    </p>
                  ) : null}
                  {formatTs(item.timestamp, lang) ? (
                    <p className="mt-0.5 text-[11px] font-medium opacity-70">{formatTs(item.timestamp, lang)}</p>
                  ) : null}
                </div>
                {item.amountUgx != null && item.amountUgx > 0 ? (
                  <p className="shrink-0 text-sm font-black tabular-nums">UGX {item.amountUgx.toLocaleString()}</p>
                ) : null}
              </div>
              <Link
                to={item.actionTo}
                className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-xl bg-white/80 px-3 text-xs font-black text-stone-900 shadow-sm"
              >
                {t(lang, item.actionLabelKey)} →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OwnerAttentionCenterSection({ lang, critical, warnings, information, periodLabel }: Props) {
  const total = critical.length + warnings.length + information.length;

  return (
    <HistoryListCard
      isEmpty={total === 0}
      empty={<p className="text-sm font-semibold text-emerald-900">{t(lang, "ownerAttentionAllClear")}</p>}
    >
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerAttentionTitle")}</h2>
          <p className="text-xs font-semibold text-slate-500">
            {tTemplate(lang, "ownerAttentionPeriod", { label: periodLabel })}
          </p>
        </div>
        {total > 0 ? (
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-black text-rose-950">{total}</span>
        ) : null}
      </div>
      <AlertGroup lang={lang} title={t(lang, "ownerAttentionCritical")} items={critical} />
      <AlertGroup lang={lang} title={t(lang, "ownerAttentionWarnings")} items={warnings} />
      <AlertGroup lang={lang} title={t(lang, "ownerAttentionInfo")} items={information} />
    </HistoryListCard>
  );
}
