import { ModalSheet } from "../../../components/layout/ModalSheet";
import { SupplierDetailPage } from "../../../pages/SupplierDetailPage";
import type { Language } from "../../../types";

type Props = {
  lang: Language;
  supplierId: string | null;
  onClose: () => void;
  onOpenPurchase?: (purchaseId: string) => void;
};

export function SupplierDetailSheet({ lang, supplierId, onClose, onOpenPurchase }: Props) {
  return (
    <ModalSheet open={supplierId != null} onClose={onClose} maxHeightClass="max-h-[96dvh]" zIndexClass="z-[58]">
      {supplierId ? (
        <SupplierDetailPage lang={lang} supplierId={supplierId} embedded onClose={onClose} onOpenPurchase={onOpenPurchase} />
      ) : null}
    </ModalSheet>
  );
}
