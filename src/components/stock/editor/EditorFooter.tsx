import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_BTN_FOOTER_BASE } from "../wizard/wizardTokens";

type Props = {
  lang: Language;
  disabled?: boolean;
  showAuditReason?: boolean;
  auditReason: string;
  onAuditReasonChange: (value: string) => void;
  saveLabelKey?: string;
};

export function EditorFooter({
  lang,
  disabled,
  showAuditReason,
  auditReason,
  onAuditReasonChange,
  saveLabelKey = "saveProduct",
}: Props) {
  return (
    <footer className="shrink-0 border-t border-border/60 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5">
      {showAuditReason ? (
        <label className="mb-3 block">
          <span className="text-sm font-bold text-foreground">{t(lang, "auditReasonLabel")}</span>
          <textarea
            value={auditReason}
            onChange={(e) => onAuditReasonChange(e.target.value)}
            className="mt-2 min-h-[72px] w-full rounded-2xl border border-input bg-card px-4 py-3 text-sm font-semibold outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/25"
            placeholder={t(lang, "auditReasonPlaceholder")}
          />
        </label>
      ) : null}
      <button
        type="submit"
        disabled={disabled}
        className={clsx(
          WIZARD_BTN_FOOTER_BASE,
          "w-full bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
        )}
      >
        {t(lang, saveLabelKey as "saveProduct")}
      </button>
    </footer>
  );
}
