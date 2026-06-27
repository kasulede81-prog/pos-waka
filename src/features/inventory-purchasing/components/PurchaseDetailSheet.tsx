import { ModalSheet } from "../../../components/layout/ModalSheet";
import { PurchaseDetailPage } from "../../../pages/PurchaseDetailPage";
import type { Language } from "../../../types";

type Props = {
  lang: Language;
  purchaseId: string | null;
  onClose: () => void;
};

export function PurchaseDetailSheet({ lang, purchaseId, onClose }: Props) {
  return (
    <ModalSheet open={purchaseId != null} onClose={onClose} maxHeightClass="max-h-[96dvh]" zIndexClass="z-[58]">
      {purchaseId ? <PurchaseDetailPage lang={lang} purchaseId={purchaseId} embedded onClose={onClose} /> : null}
    </ModalSheet>
  );
}
