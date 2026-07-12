import type { Language } from "../../../types";
import { ConfirmationDialog } from "../../layout/ConfirmationDialog";
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
  children,
}: Props) {
  return (
    <ConfirmationDialog
      lang={lang}
      open={open}
      onClose={onCancel}
      title={title}
      confirmLabelKey={confirmLabelKey}
      cancelLabelKey={cancelLabelKey}
      onConfirm={onConfirm}
      confirmBusy={busy}
      destructive={danger}
    >
      {body}
      {children}
    </ConfirmationDialog>
  );
}
