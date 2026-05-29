import { useTransition } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function IncludeArchivedFilter({ lang, checked, onChange, className = "" }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <label
      className={`flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-xl border border-stone-200/90 bg-stone-50/90 px-3 py-2 text-xs font-semibold text-stone-700 sm:text-sm ${isPending ? "opacity-80" : ""} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={isPending}
        onChange={(e) => {
          startTransition(() => onChange(e.target.checked));
        }}
        className="h-4 w-4 shrink-0 rounded border-stone-300 text-waka-600"
      />
      <span className="min-w-0 flex-1 leading-snug">{t(lang, "includeArchivedRecords")}</span>
      {isPending ? (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-waka-700">
          {t(lang, "includeArchivedLoading")}
        </span>
      ) : null}
    </label>
  );
}
