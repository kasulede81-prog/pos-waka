import { AdjustmentStatusStrip } from "../adjustments/AdjustmentStatusStrip";
import type { Language } from "../../../types";

type Props = {
  lang: Language;
  className?: string;
};

export function TransferStatusStrip({ lang, className }: Props) {
  return <AdjustmentStatusStrip lang={lang} className={className} />;
}
