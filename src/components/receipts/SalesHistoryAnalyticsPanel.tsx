import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Metric = { label: string; value: string };

type Props = {
  lang: Language;
  metrics: Metric[];
};

export function SalesHistoryAnalyticsPanel({ lang, metrics }: Props) {
  const [open, setOpen] = useState(false);
  if (metrics.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/90 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-[44px] items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-black text-foreground">{t(lang, "salesHistoryAnalytics")}</span>
        <ChevronDown className={clsx("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <dl className="grid grid-cols-2 gap-2 border-t border-border px-3 py-3 sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg bg-muted px-2.5 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{m.label}</dt>
              <dd className="mt-0.5 text-sm font-black tabular-nums text-foreground">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
