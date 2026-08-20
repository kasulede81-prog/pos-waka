import { useContext } from "react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { useVisualViewportBounds } from "../../../hooks/useVisualViewportBounds";
import { WIZARD_BTN_FOOTER_BASE } from "./receiveTokens";
import { ReceiveFormIdContext } from "./ReceiveOperationShell";

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
  fixed?: boolean;
  cancelLabelKey?: string;
};

export function ReceiveFooter({
  lang,
  primaryLabelKey,
  onCancel,
  primaryDisabled,
  primaryBusy,
  primaryType = "submit",
  onPrimary,
  layout = "dual",
  primaryClassName,
  fixed,
  cancelLabelKey = "cancel",
}: Props) {
  const formId = useContext(ReceiveFormIdContext);
  const submitFormId = primaryType === "submit" ? formId : undefined;
  const viewport = useVisualViewportBounds();
  // Fixed page footers sit under the soft keyboard — fall back to in-flow when keyboard is open.
  const useFixed = Boolean(fixed) && viewport.keyboardGap < 80;

  return (
    <footer
      className={clsx(
        "shrink-0 border-t border-border/60 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5",
        useFixed &&
          "fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom))] left-0 right-0 z-30 sm:static sm:border-t sm:bg-card/95",
      )}
    >
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
            form={submitFormId}
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
          form={submitFormId}
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
