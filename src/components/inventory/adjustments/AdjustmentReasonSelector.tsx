import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { AdjustmentReasonDef } from "../../../lib/adjustmentWorkspace";
import { AdjustmentHeader } from "./AdjustmentHeader";
import { wizardChoiceButtonClass } from "./adjustmentTokens";

type Props = {
  lang: Language;
  reasons: AdjustmentReasonDef[];
  value: string;
  onChange: (id: string) => void;
};

export function AdjustmentReasonSelector({ lang, reasons, value, onChange }: Props) {
  return (
    <section className="space-y-3">
      <AdjustmentHeader title={t(lang, "adjReasonTitle")} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {reasons.map((reason) => (
          <button
            key={reason.id}
            type="button"
            onClick={() => onChange(reason.id)}
            className={clsx(wizardChoiceButtonClass(value === reason.id), "min-h-[48px] text-xs")}
          >
            {t(lang, reason.labelKey)}
          </button>
        ))}
      </div>
    </section>
  );
}
