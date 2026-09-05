import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { themeUi } from "../../lib/themeTokens";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { Caption } from "../enterprise/EnterpriseTypography";

type Metric = { label: string; value: string };

type Props = {
  lang: Language;
  metrics: Metric[];
};

export function SalesHistoryAnalyticsPanel({ lang, metrics }: Props) {
  const [open, setOpen] = useState(false);
  if (metrics.length === 0) return null;

  return (
    <div className={clsx(themeUi.surface, "overflow-hidden")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={clsx(
          "flex w-full min-h-12 items-center justify-between gap-2 px-4 py-3 text-left",
          enterpriseMotion.standard,
          themeUi.focusRing,
        )}
      >
        <span className="text-base font-bold tracking-tight text-foreground">{t(lang, "salesHistoryMoreInsights")}</span>
        <ChevronDown
          className={clsx("h-5 w-5 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <dl className="grid grid-cols-2 gap-3 border-t border-border px-4 py-4 sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl bg-waka-50/80 px-3 py-2.5 ring-1 ring-waka-200/50">
              <dt>
                <Caption>{m.label}</Caption>
              </dt>
              <dd className="mt-1 text-base font-bold tabular-nums text-foreground">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
