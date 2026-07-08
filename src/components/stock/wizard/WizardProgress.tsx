import { tTemplate } from "../../../lib/i18n";
import type { Language } from "../../../types";

type Props = {
  lang: Language;
  stepIndex: number;
  totalSteps: number;
};

export function WizardProgress({ lang, stepIndex, totalSteps }: Props) {
  const progressPct = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div
      className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={stepIndex + 1}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-label={tTemplate(lang, "simpleAddStepOf", {
        n: String(stepIndex + 1),
        total: String(totalSteps),
      })}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${progressPct}%` }}
      />
    </div>
  );
}
