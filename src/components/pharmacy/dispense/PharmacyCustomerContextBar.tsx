import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { PharmacyCustomerContextMode } from "./pharmacyDispenseTypes";

type Props = {
  lang: Language;
  mode: PharmacyCustomerContextMode;
  displayLabel: string;
  onModeChange: (mode: PharmacyCustomerContextMode) => void;
};

const MODES: PharmacyCustomerContextMode[] = [
  "walk_in",
  "existing_patient",
  "new_patient",
  "prescription_queue",
];

function modeLabelKey(mode: PharmacyCustomerContextMode): string {
  switch (mode) {
    case "walk_in":
      return "pharmacyDispenseWalkIn";
    case "existing_patient":
      return "pharmacyDispenseExistingPatient";
    case "new_patient":
      return "pharmacyDispenseNewPatient";
    case "prescription_queue":
      return "pharmacyDispenseRxQueue";
  }
}

export function PharmacyCustomerContextBar({ lang, mode, displayLabel, onModeChange }: Props) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-2 sm:px-3">
      <label className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
        <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
          {t(lang, "pharmacyDispenseContextLabel")}
        </span>
        <span className="relative min-w-0 flex-1">
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as PharmacyCustomerContextMode)}
            className={clsx(
              "w-full appearance-none rounded-xl border-2 border-border bg-muted py-2.5 pl-3 pr-9",
              "text-sm font-black text-foreground touch-manipulation",
              "focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-200/80",
            )}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(lang, modeLabelKey(m))}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </span>
      </label>
      <p className="min-w-0 truncate text-sm font-bold text-teal-900 sm:max-w-[40%]">{displayLabel}</p>
    </div>
  );
}
