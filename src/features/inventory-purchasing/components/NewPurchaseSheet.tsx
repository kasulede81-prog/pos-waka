import { ModalSheet } from "../../../components/layout/ModalSheet";
import { RestockPage } from "../../../pages/RestockPage";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
};

export function NewPurchaseSheet({ lang, open, onClose }: Props) {
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={t(lang, "ipNewPurchaseTitle")}
      zIndexClass="z-[60]"
      maxHeightClass="max-h-[96dvh]"
      panelClassName="sm:max-w-lg"
    >
      <RestockPage lang={lang} embedded onSaved={onClose} />
    </ModalSheet>
  );
}
