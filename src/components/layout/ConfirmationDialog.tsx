import type { ReactNode } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "./ModalSheet";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  confirmLabelKey?: string;
  cancelLabelKey?: string;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  destructive?: boolean;
};

/**
 * Tier C — keyboard-aware confirmation dialog (Enterprise Modal Standard).
 */
export function ConfirmationDialog({
  lang,
  open,
  onClose,
  title,
  children,
  confirmLabelKey = "confirm",
  cancelLabelKey = "cancel",
  onConfirm,
  confirmDisabled,
  confirmBusy,
  destructive,
}: Props) {
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={title}
      align="center"
      maxHeightClass="max-h-[min(88dvh,480px)]"
      panelClassName="max-w-sm"
      footer={
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-bold text-stone-800"
          >
            {t(lang, cancelLabelKey)}
          </button>
          <button
            type="button"
            disabled={confirmDisabled || confirmBusy}
            onClick={onConfirm}
            className={clsx(
              "min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-black text-white disabled:opacity-50",
              destructive ? "bg-rose-600 hover:bg-rose-700" : "bg-waka-600 hover:bg-waka-700",
            )}
          >
            {confirmBusy ? "…" : t(lang, confirmLabelKey)}
          </button>
        </div>
      }
    >
      {children ? <div className="text-sm font-medium text-stone-600">{children}</div> : null}
    </ModalSheet>
  );
}
