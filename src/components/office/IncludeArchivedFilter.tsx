import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function IncludeArchivedFilter({ lang, checked, onChange, className = "" }: Props) {
  return (
    <label
      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-sm ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-stone-300 text-waka-600"
      />
      {t(lang, "includeArchivedRecords")}
    </label>
  );
}
