import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  onEnableArchived: () => void;
  archivedCount: number;
};

export function DateFilterArchiveNotice({ lang, onEnableArchived, archivedCount }: Props) {
  if (archivedCount === 0) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
        {t(lang, "dateFilterArchiveEmpty")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-sm font-semibold text-amber-950">{t(lang, "dateFilterArchivePrompt")}</p>
      <button
        type="button"
        onClick={onEnableArchived}
        className="shrink-0 rounded-xl bg-amber-800 px-3 py-1.5 text-xs font-black text-white"
      >
        {t(lang, "dateFilterArchiveLoad")}
      </button>
    </div>
  );
}
