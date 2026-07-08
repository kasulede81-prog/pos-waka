import { ArrowDown } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { AdjustmentHeader } from "./AdjustmentHeader";

type Props = {
  lang: Language;
  mode?: "delta" | "count" | "return";
  currentStock: number;
  adjustment: number;
  unitLabel?: string;
  expectedStock?: number;
  countedStock?: number;
};

export function AdjustmentMovementPreview({
  lang,
  mode = "delta",
  currentStock,
  adjustment,
  unitLabel,
  expectedStock,
  countedStock,
}: Props) {
  const unit = unitLabel ? ` ${unitLabel}` : "";

  if (mode === "count" && expectedStock != null && countedStock != null) {
    const variance = countedStock - expectedStock;
    return (
      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <AdjustmentHeader title={t(lang, "adjMovementCountTitle")} />
        <dl className="mt-3 grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
          <div>
            <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "inventoryCountSnapshotStock")}</dt>
            <dd className="text-xl font-black tabular-nums">{expectedStock.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "inventoryCountCounted")}</dt>
            <dd className="text-xl font-black tabular-nums">{countedStock.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase text-primary">{t(lang, "inventoryCountVariance")}</dt>
            <dd className="text-xl font-black tabular-nums text-primary">
              {variance >= 0 ? "+" : ""}
              {variance.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  if (adjustment === 0) return null;
  const after = currentStock + adjustment;

  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <AdjustmentHeader title={t(lang, "adjMovementTitle")} />
      <div className="mt-3 flex flex-col items-center gap-1 text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "receiveMovementCurrent")}
          </p>
          <p className="text-2xl font-black tabular-nums">
            {currentStock.toLocaleString()}
            {unit}
          </p>
        </div>
        <ArrowDown className="h-4 w-4 text-primary" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
            {mode === "return" ? t(lang, "adjMovementReturned") : t(lang, "adjMovementAdjusting")}
          </p>
          <p className="text-xl font-black tabular-nums text-primary">
            {adjustment >= 0 ? "+" : ""}
            {adjustment.toLocaleString()}
            {unit}
          </p>
        </div>
        <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "receiveMovementAfter")}
          </p>
          <p className="text-2xl font-black tabular-nums">
            {after.toLocaleString()}
            {unit}
          </p>
        </div>
      </div>
    </section>
  );
}
