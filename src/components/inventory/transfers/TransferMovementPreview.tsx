import { ArrowDown } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { TransferHeader } from "./TransferHeader";

type Props = {
  lang: Language;
  currentStock: number;
  transferQty: number;
  unitLabel?: string;
};

export function TransferMovementPreview({ lang, currentStock, transferQty, unitLabel }: Props) {
  if (transferQty <= 0) return null;
  const remaining = Math.max(0, currentStock - transferQty);
  const unit = unitLabel ? ` ${unitLabel}` : "";

  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <TransferHeader title={t(lang, "xferMovementTitle")} />
      <div className="mt-3 flex flex-col items-center gap-1 text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "xferMovementCurrent")}
          </p>
          <p className="text-2xl font-black tabular-nums">{currentStock.toLocaleString()}{unit}</p>
        </div>
        <ArrowDown className="h-4 w-4 text-primary" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
            {t(lang, "xferMovementTransferring")}
          </p>
          <p className="text-xl font-black tabular-nums text-primary">
            −{transferQty.toLocaleString()}{unit}
          </p>
        </div>
        <ArrowDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "xferMovementRemaining")}
          </p>
          <p className="text-2xl font-black tabular-nums">{remaining.toLocaleString()}{unit}</p>
        </div>
      </div>
    </section>
  );
}
