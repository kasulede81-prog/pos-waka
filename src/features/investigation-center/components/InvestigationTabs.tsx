import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { InvestigationTab } from "../types";

type Props = {
  lang: Language;
  active: InvestigationTab;
  onChange: (tab: InvestigationTab) => void;
  tabs: InvestigationTab[];
};

function labelFor(lang: Language, tab: InvestigationTab): string {
  if (tab === "timeline") return t(lang, "auditTabTimeline");
  if (tab === "staff") return t(lang, "auditTabStaff");
  if (tab === "refunds") return t(lang, "auditTabRefunds");
  if (tab === "compliance") return t(lang, "icPharmacyTabCompliance");
  return tab;
}

export function InvestigationTabs({ lang, active, onChange, tabs }: Props) {
  return (
    <div className="-mx-0.5 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-muted/80 p-1 [-webkit-overflow-scrolling:touch]">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={clsx(
            "min-h-[40px] flex-1 shrink-0 rounded-xl px-3 text-xs font-black transition-all sm:text-sm",
            active === tab ? "bg-card text-waka-700 shadow-sm" : "text-muted-foreground active:bg-white/70",
          )}
        >
          {labelFor(lang, tab)}
        </button>
      ))}
    </div>
  );
}
