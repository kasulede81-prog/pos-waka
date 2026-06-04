import type { Language } from "../../types";
import { tTemplate } from "../../lib/i18n";
import type { DateFilterValue } from "../../lib/dateFilters";
import { formatDateFilterViewingLabel } from "../../lib/dateFilterLabels";

type Props = {
  lang: Language;
  value: DateFilterValue;
};

export function DateFilterViewingLabel({ lang, value }: Props) {
  const label = formatDateFilterViewingLabel(lang, value);
  return (
    <p className="rounded-xl border border-waka-100 bg-waka-50/90 px-3 py-2 text-sm font-bold text-waka-950">
      {tTemplate(lang, "dateFilterViewing", { label })}
    </p>
  );
}
