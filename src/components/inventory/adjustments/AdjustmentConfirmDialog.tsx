import { AppModalOverlay } from "../../layout/AppModalOverlay";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_BTN_FOOTER_BASE } from "./adjustmentTokens";
import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  lang: Language;
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabelKey: string;
  cancelLabelKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
  zClassName?: string;
  children?: ReactNode;
};

export function AdjustmentConfirmDialog({
  lang,
  open,
  title,
  body,
  confirmLabelKey,
  cancelLabelKey = "cancel",
  onConfirm,
  onCancel,
  busy,
  danger,
  zClassName = "z-[70]",
  children,
}: Props) {
  if (!open) return null;

  return (
    <AppModalOverlay
      className={clsx(zClassName, "flex items-center justify-center bg-black/55 p-4")}
      role="dialog"
      aria-modal
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-border/60 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-lg font-black text-foreground">{title}</p>
        <div className="mt-2 text-sm font-semibold text-muted-foreground">{body}</div>
        {children}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={clsx(WIZARD_BTN_FOOTER_BASE, "flex-1 border border-border bg-card text-foreground")}
          >
            {t(lang, cancelLabelKey)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={clsx(
              WIZARD_BTN_FOOTER_BASE,
              "flex-1 text-white",
              danger ? "bg-rose-700 hover:bg-rose-800" : "bg-primary hover:bg-primary/90",
            )}
          >
            {busy ? "…" : t(lang, confirmLabelKey)}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
