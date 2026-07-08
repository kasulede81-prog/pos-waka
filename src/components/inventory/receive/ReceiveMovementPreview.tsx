import { ArrowDown } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { ReceiveHeader } from "./ReceiveHeader";

type Props = {
  lang: Language;
  currentStock: number;
  receiving: number;
  unitLabel?: string;
};

export function ReceiveMovementPreview({ lang, currentStock, receiving, unitLabel }: Props) {
  if (receiving <= 0) return null;
  const after = currentStock + receiving;
  const unit = unitLabel ? ` ${unitLabel}` : "";

  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <ReceiveHeader title={t(lang, "receiveMovementTitle")} />
      <div className="mt-3 flex flex-col items-center gap-1 text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "receiveMovementCurrent")}
          </p>
          <p className="text-2xl font-black tabular-nums text-foreground">
            {currentStock.toLocaleString()}
            {unit}
          </p>
        </div>
        <ArrowDown className="h-4 w-4 text-primary" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
            {t(lang, "receiveMovementReceiving")}
          </p>
          <p className="text-xl font-black tabular-nums text-primary">
            +{receiving.toLocaleString()}
            {unit}
          </p>
        </div>
        <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "receiveMovementAfter")}
          </p>
          <p className="text-2xl font-black tabular-nums text-foreground">
            {after.toLocaleString()}
            {unit}
          </p>
        </div>
      </div>
    </section>
  );
}
