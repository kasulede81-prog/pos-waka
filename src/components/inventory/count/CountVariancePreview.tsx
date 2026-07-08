import { ArrowDown } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { inventoryCountVarianceTone, varianceToneClass } from "../../../lib/countWorkspace";
import { COUNT_SECTION_LABEL } from "./countTokens";

type Props = {
  lang: Language;
  expected: number;
  counted: number;
  unitLabel?: string;
};

export function CountVariancePreview({ lang, expected, counted, unitLabel }: Props) {
  const variance = counted - expected;
  const tone = inventoryCountVarianceTone(variance);
  const unit = unitLabel ? ` ${unitLabel}` : "";

  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <p className={COUNT_SECTION_LABEL}>{t(lang, "cntVariancePreviewTitle")}</p>
      <div className="mt-3 flex flex-col items-center gap-1 text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "inventoryCountSnapshotStock")}
          </p>
          <p className="text-2xl font-black tabular-nums">{expected.toLocaleString()}{unit}</p>
        </div>
        <ArrowDown className="h-4 w-4 text-primary" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "inventoryCountCounted")}
          </p>
          <p className="text-2xl font-black tabular-nums">{counted.toLocaleString()}{unit}</p>
        </div>
        <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
            {t(lang, "inventoryCountVariance")}
          </p>
          <p className={clsx("text-2xl font-black tabular-nums", varianceToneClass(tone))}>
            {variance >= 0 ? "+" : ""}
            {variance.toLocaleString()}
            {unit}
          </p>
        </div>
      </div>
    </section>
  );
}
