import { AdjustmentStatusStrip } from "../adjustments/AdjustmentStatusStrip";
import type { Language } from "../../../types";

type Props = {
  lang: Language;
  className?: string;
};

/** Reuses enterprise status strip — no duplicate sync/date logic. */
export function CountStatusStrip({ lang, className }: Props) {
  return <AdjustmentStatusStrip lang={lang} className={className} />;
}
