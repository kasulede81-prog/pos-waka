import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { AttentionItem } from "../../lib/ownerCommandCenter";

type Props = {
  lang: Language;
  critical: AttentionItem[];
  warnings: AttentionItem[];
  information: AttentionItem[];
  reviewedCritical: AttentionItem[];
  reviewedWarnings: AttentionItem[];
  periodLabel: string;
  onAcknowledge: (alertId: string) => void;
};

function severityStyles(severity: AttentionItem["severity"]) {
  if (severity === "critical") return { badge: "bg-rose-100 text-rose-800", border: "border-rose-100" };
  if (severity === "warning") return { badge: "bg-amber-100 text-amber-900", border: "border-amber-100" };
  return { badge: "bg-sky-100 text-sky-900", border: "border-sky-100" };
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

function AlertCard({
  lang,
  item,
  onAcknowledge,
}: {
  lang: Language;
  item: AttentionItem;
  onAcknowledge?: (id: string) => void;
}) {
  const styles = severityStyles(item.severity);
  return (
    <article className={clsx("rounded-2xl border bg-card p-3 shadow-sm", styles.border)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase", styles.badge)}>
            {item.severity === "critical"
              ? t(lang, "ownerAttentionCritical")
              : item.severity === "warning"
                ? t(lang, "ownerAttentionWarnings")
                : t(lang, "ownerAttentionInfo")}
          </span>
          <h3 className="mt-1.5 text-sm font-black text-foreground">
            {item.titleVars ? tTemplate(lang, item.titleKey, item.titleVars) : t(lang, item.titleKey)}
          </h3>
          {item.detailKey ? (
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
              {item.detailVars ? tTemplate(lang, item.detailKey, item.detailVars) : t(lang, item.detailKey)}
            </p>
          ) : null}
          {item.actorLabel ? (
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
              {t(lang, "ownerAttentionActor")}: {item.actorLabel}
            </p>
          ) : null}
          {formatTs(item.timestamp, lang) ? (
            <p className="text-[11px] font-medium text-muted-foreground">{formatTs(item.timestamp, lang)}</p>
          ) : null}
        </div>
        {item.amountUgx != null && item.amountUgx > 0 ? (
          <p className="shrink-0 text-sm font-black tabular-nums text-foreground">
            UGX {item.amountUgx.toLocaleString()}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <Link
          to={item.actionTo}
          className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-xl bg-waka-600 px-3 text-xs font-black text-white"
        >
          {t(lang, item.actionLabelKey)}
        </Link>
        {onAcknowledge && item.acknowledgeable !== false && item.severity !== "information" ? (
          <button
            type="button"
            onClick={() => onAcknowledge(item.id)}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-xl border border-border bg-muted px-3 text-xs font-black text-foreground"
          >
            {t(lang, "ownerAttentionAcknowledge")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function CommandCenterAttentionSection({
  lang,
  critical,
  warnings,
  information,
  reviewedCritical,
  reviewedWarnings,
  periodLabel,
  onAcknowledge,
}: Props) {
  const [showReviewed, setShowReviewed] = useState(false);
  const active = [...critical, ...warnings, ...information];
  const reviewedTotal = reviewedCritical.length + reviewedWarnings.length;

  return (
    <section className="rounded-3xl border border-border/90 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cmdCenterAttentionTitle")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {tTemplate(lang, "ownerAttentionPeriod", { label: periodLabel })}
          </p>
        </div>
        {active.length > 0 ? (
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-black text-rose-950">{active.length}</span>
        ) : null}
      </div>

      {active.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-emerald-50 px-3 py-4 text-sm font-semibold text-emerald-900">
          {t(lang, "ownerAttentionAllClear")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {active.map((item) => (
            <li key={item.id}>
              <AlertCard lang={lang} item={item} onAcknowledge={onAcknowledge} />
            </li>
          ))}
        </ul>
      )}

      {reviewedTotal > 0 ? (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowReviewed((v) => !v)}
            className="flex w-full items-center justify-between py-2 text-xs font-black text-muted-foreground"
          >
            <span>{tTemplate(lang, "ownerAttentionReviewed", { count: reviewedTotal })}</span>
            <span>{showReviewed ? "−" : "+"}</span>
          </button>
          {showReviewed ? (
            <ul className="space-y-2">
              {[...reviewedCritical, ...reviewedWarnings].map((item) => (
                <li key={item.id}>
                  <AlertCard lang={lang} item={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
