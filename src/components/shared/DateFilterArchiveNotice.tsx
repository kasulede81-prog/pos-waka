import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { statusTokens } from "../../lib/statusTokens";
import { themeUi } from "../../lib/themeTokens";

type Props = {
  lang: Language;
  onEnableArchived: () => void;
  archivedCount: number;
};

export function DateFilterArchiveNotice({ lang, onEnableArchived, archivedCount }: Props) {
  if (archivedCount === 0) {
    return (
      <p className={statusTokens.warning.banner}>{t(lang, "dateFilterArchiveEmpty")}</p>
    );
  }
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${statusTokens.warning.banner}`}>
      <p>{t(lang, "dateFilterArchivePrompt")}</p>
      <button
        type="button"
        onClick={onEnableArchived}
        className={`${themeUi.btnPrimary} min-h-10 shrink-0 px-3 py-1.5 text-sm`}
      >
        {t(lang, "dateFilterArchiveLoad")}
      </button>
    </div>
  );
}
