import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_BTN_FOOTER_BASE } from "./transferTokens";

type Props = {
  lang: Language;
  primaryLabelKey: string;
  onCancel?: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  primaryType?: "submit" | "button";
  onPrimary?: () => void;
  layout?: "dual" | "single";
  primaryClassName?: string;
  cancelLabelKey?: string;
};

export function TransferFooter({
  lang,
  primaryLabelKey,
  onCancel,
  primaryDisabled,
  primaryBusy,
  primaryType = "button",
  onPrimary,
  layout = "dual",
  primaryClassName,
  cancelLabelKey = "cancel",
}: Props) {
  return (
    <footer className="shrink-0 border-t border-border/60 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5">
      {layout === "dual" && onCancel ? (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className={clsx(
              WIZARD_BTN_FOOTER_BASE,
              "border border-border bg-card text-foreground shadow-sm hover:bg-muted",
            )}
          >
            {t(lang, cancelLabelKey)}
          </button>
          <button
            type={primaryType}
            disabled={primaryDisabled || primaryBusy}
            onClick={primaryType === "button" ? onPrimary : undefined}
            className={clsx(
              WIZARD_BTN_FOOTER_BASE,
              primaryClassName ?? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
            )}
          >
            {primaryBusy ? "…" : t(lang, primaryLabelKey)}
          </button>
        </div>
      ) : (
        <button
          type={primaryType}
          disabled={primaryDisabled || primaryBusy}
          onClick={primaryType === "button" ? onPrimary : undefined}
          className={clsx(
            WIZARD_BTN_FOOTER_BASE,
            "w-full",
            primaryClassName ?? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
          )}
        >
          {primaryBusy ? "…" : t(lang, primaryLabelKey)}
        </button>
      )}
    </footer>
  );
}
