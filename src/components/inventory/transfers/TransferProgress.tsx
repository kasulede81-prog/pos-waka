import clsx from "clsx";
import { Check } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import {
  TRANSFER_PROGRESS_STAGES,
  transferProgressIndex,
  type TransferProgressStage,
} from "../../../lib/transferWorkspace";

type Props = {
  lang: Language;
  stage: TransferProgressStage;
};

const STAGE_LABEL_KEYS: Record<TransferProgressStage, string> = {
  location: "xferProgressLocation",
  products: "xferProgressProducts",
  review: "xferProgressReview",
  transfer: "xferProgressTransfer",
  complete: "xferProgressComplete",
};

export function TransferProgress({ lang, stage }: Props) {
  const activeIndex = transferProgressIndex(stage);

  return (
    <nav aria-label={t(lang, "xferProgressLabel")} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
      <ol className="flex items-center justify-between gap-1">
        {TRANSFER_PROGRESS_STAGES.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span
                className={clsx(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition-colors",
                  done && "bg-primary text-primary-foreground",
                  active && !done && "border-2 border-primary bg-primary/10 text-primary",
                  !done && !active && "border border-border bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              <span
                className={clsx(
                  "max-w-full truncate text-center text-[10px] font-bold uppercase tracking-wide",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {t(lang, STAGE_LABEL_KEYS[s])}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
