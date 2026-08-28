import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CartVoidCopyKeys } from "../../lib/saleLifecycle";
import { ConfirmationDialog } from "../layout/ConfirmationDialog";

type Props = {
  lang: Language;
  open: boolean;
  copy: CartVoidCopyKeys;
  onKeep: () => void;
  onConfirm: () => void;
};

/** Cashier confirmation for Void sale / Void pending sale. Not completed-sale void. */
export function CartVoidConfirmDialog({ lang, open, copy, onKeep, onConfirm }: Props) {
  return (
    <ConfirmationDialog
      lang={lang}
      open={open}
      onClose={onKeep}
      title={t(lang, copy.titleKey)}
      cancelLabelKey={copy.keepKey}
      confirmLabelKey={copy.confirmKey}
      onConfirm={onConfirm}
      destructive
    >
      {t(lang, copy.bodyKey)}
    </ConfirmationDialog>
  );
}
