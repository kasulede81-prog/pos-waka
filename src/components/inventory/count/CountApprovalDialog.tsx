import type { ReactNode } from "react";
import type { Language } from "../../../types";
import { ConfirmationDialog } from "../../layout/ConfirmationDialog";
import { CountValidationBanner } from "./CountValidationBanner";

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
  warning?: string | null;
  children?: ReactNode;
};

export function CountApprovalDialog({
  lang,
  open,
  title,
  body,
  confirmLabelKey,
  cancelLabelKey = "cancel",
  onConfirm,
  onCancel,
  busy,
  warning,
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
    >
      {body}
      {warning ? (
        <div className="mt-3">
          <CountValidationBanner message={warning} tone="warning" />
        </div>
      ) : null}
      {children}
    </ConfirmationDialog>
  );
}
