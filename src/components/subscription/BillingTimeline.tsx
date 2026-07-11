import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { BillingTimelineEvent } from "../../lib/subscriptionHistory";

type Props = {
  lang: Language;
  events: BillingTimelineEvent[];
  compact?: boolean;
  className?: string;
};

const KIND_COLORS: Record<string, string> = {
  trial_started: "border-sky-200 bg-sky-50 text-sky-900",
  trial_extended: "border-sky-200 bg-sky-50 text-sky-900",
  subscription_granted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  renewed: "border-emerald-200 bg-emerald-50 text-emerald-900",
  paused: "border-amber-200 bg-amber-50 text-amber-900",
  cancelled: "border-rose-200 bg-rose-50 text-rose-900",
  expired: "border-border bg-muted text-foreground",
  promotional_grant: "border-violet-200 bg-violet-50 text-violet-900",
  promotional_revoked: "border-violet-200 bg-violet-50 text-violet-900",
  plan_changed: "border-waka-200 bg-waka-50 text-waka-900",
  grace_period: "border-amber-200 bg-amber-50 text-amber-900",
  renewal_reminder: "border-blue-200 bg-blue-50 text-blue-900",
  other: "border-border bg-muted text-foreground",
};

function timelineLabel(lang: Language, kind: string, fallback: string): string {
  const key = `billingTimeline_${kind}`;
  const translated = t(lang, key as "billingTimeline_trial_started");
  return translated === key ? fallback : translated;
}

export function BillingTimeline({ lang, events, compact = false, className }: Props) {
  if (events.length === 0) {
    return (
      <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
        {t(lang, "billingHistoryEmpty")}
      </p>
    );
  }

  return (
    <ol className={clsx("relative space-y-0", className)}>
      {events.map((ev, idx) => (
        <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
          {idx < events.length - 1 ? (
            <span className="absolute left-[11px] top-6 h-[calc(100%-0.5rem)] w-0.5 bg-muted" aria-hidden />
          ) : null}
          <span
            className={clsx(
              "relative z-10 mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 bg-card",
              KIND_COLORS[ev.kind]?.split(" ")[0] ?? "border-border",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div
              className={clsx(
                "rounded-xl border px-3 py-2",
                compact ? "text-xs" : "text-sm",
                KIND_COLORS[ev.kind] ?? KIND_COLORS.other,
              )}
            >
              <p className="font-black capitalize">{timelineLabel(lang, ev.kind, ev.label)}</p>
              <p className="mt-0.5 font-mono text-[10px] opacity-80">
                {new Date(ev.timestamp).toLocaleString("en-GB")}
              </p>
              {ev.reason ? <p className="mt-1 font-semibold opacity-90">{ev.reason}</p> : null}
              {!compact && (ev.source || ev.operator) ? (
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide opacity-70">
                  {[ev.source, ev.operator ? `· ${ev.operator.slice(0, 8)}…` : null].filter(Boolean).join(" ")}
                </p>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
