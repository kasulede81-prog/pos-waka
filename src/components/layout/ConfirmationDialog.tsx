import type { ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WakaButton } from "../ui/wakaPrimitives";
import { ModalSheet } from "./ModalSheet";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";

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
          <WakaButton type="button" variant="secondary" onClick={onClose}>
            {t(lang, cancelLabelKey)}
          </WakaButton>
          <WakaButton
            type="button"
            variant={destructive ? "danger" : "primary"}
            disabled={confirmDisabled}
            loading={confirmBusy}
            onClick={onConfirm}
          >
            {t(lang, confirmLabelKey)}
          </WakaButton>
        </div>
      }
    >
      {children ? (
        <div className={enterpriseTypeClass("body", "text-muted-foreground")}>{children}</div>
      ) : null}
    </ModalSheet>
  );
}
