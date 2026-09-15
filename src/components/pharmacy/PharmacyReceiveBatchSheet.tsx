import { useMemo, useState, type FormEvent } from "react";
import { Pill } from "lucide-react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { formatMedicineFullLabel } from "../../lib/pharmacyMedicine";
import { WALK_IN_SUPPLIER_ID } from "../../lib/walkInSupplier";
import { isControlledProduct } from "../../lib/pharmacyControlledMedicine";
import { dateKeyKampala } from "../../lib/datesUg";
import { ReceiveOperationShell } from "../inventory/receive/ReceiveOperationShell";
import { SupplierSelector } from "../inventory/receive/SupplierSelector";
import { PurchaseLineEditor } from "../inventory/receive/PurchaseLineEditor";
import { BatchReceiveExtension } from "../inventory/receive/BatchReceiveExtension";
import { ReceiveMovementPreview } from "../inventory/receive/ReceiveMovementPreview";
import { ReceiveSummaryPanel } from "../inventory/receive/ReceiveSummaryPanel";
import { ReceiveFooter } from "../inventory/receive/ReceiveFooter";
import { ReceiveStatusStrip } from "../inventory/receive/ReceiveStatusStrip";

type Props = {
  lang: Language;
  product: Product;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

export function PharmacyReceiveBatchSheet({ lang, product, open, onClose, onDone }: Props) {
  const recordPurchase = usePosStore((s) => s.recordPurchase);
  const suppliers = usePosStore((s) => s.suppliers);
  const [supplierId, setSupplierId] = useState(WALK_IN_SUPPLIER_ID);
  const [invoice, setInvoice] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(String(product.costPricePerUnitUgx || ""));
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qtyN = Math.floor(Number(quantity)) || 0;
  const costN = Math.round(Number(unitCost)) || 0;
  const invoiceTotalUgx = qtyN * costN;
  const supplierName = useMemo(() => {
    if (supplierId === WALK_IN_SUPPLIER_ID) return t(lang, "restockTownBuy");
    return suppliers.find((s) => s.id === supplierId)?.name;
  }, [supplierId, suppliers, lang]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const qty = Math.floor(Number(quantity));
    const cost = Math.round(Number(unitCost));
    if (!batchNumber.trim()) {
      setError(t(lang, "pharmacyBatchNumberRequired"));
      return;
    }
    if (!expiryDate) {
      setError(t(lang, "pharmacyExpiryDateRequired"));
      return;
    }
    if (qty <= 0 || cost < 0) {
      setError(t(lang, "invalidQty"));
      return;
    }
    setBusy(true);
    const r = recordPurchase({
      supplierId,
      lines: [
        {
          productId: product.id,
          baseUnitsIn: qty,
          costPerBaseUnitUgx: cost,
          batchReceive: {
            batchNumber: batchNumber.trim(),
            expiryDate,
            quantityBase: qty,
            unitCostUgx: cost,
            manufactureDate: manufactureDate || null,
            purchaseInvoice: invoice.trim() || null,
            location: location.trim() || null,
          },
        },
      ],
      amountPaidUgx: qty * cost,
      notes: invoice.trim() ? `Invoice ${invoice.trim()}` : "",
    });
    setBusy(false);
    if (!r.ok) {
      setError(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    onDone?.();
    onClose();
  };

  return (
    <ReceiveOperationShell
      lang={lang}
      open={open}
      title={t(lang, "pharmacyReceiveTitle")}
      subtitle={formatMedicineFullLabel(product)}
      error={error}
      onSubmit={submit}
      onRequestClose={onClose}
      zClassName="z-[75]"
      icon={<Pill className="h-5 w-5" strokeWidth={2.25} aria-hidden />}
      statusStrip={<ReceiveStatusStrip lang={lang} />}
      footer={
        <ReceiveFooter
          lang={lang}
          onCancel={onClose}
          primaryLabelKey="pharmacyReceiveCta"
          primaryBusy={busy}
          primaryClassName="bg-teal-600 text-white shadow-md hover:bg-teal-700"
        />
      }
    >
      <SupplierSelector
        lang={lang}
        mode="dropdown"
        suppliers={suppliers}
        supplierId={supplierId}
        onSupplierIdChange={setSupplierId}
        addSupplierHref="/pharmacy/inventory?tab=suppliers"
      />

      <PurchaseLineEditor
        lang={lang}
        product={product}
        quantityLabel={`${t(lang, "stockLabel")} *`}
        quantityValue={quantity}
        onQuantityChange={setQuantity}
        quantityInputMode="numeric"
        costLabel={`${t(lang, "pharmacyEditBuyPriceLabel")} *`}
        costValue={unitCost}
        onCostChange={setUnitCost}
        extension={
          <BatchReceiveExtension
            lang={lang}
            batchNumber={batchNumber}
            onBatchNumberChange={setBatchNumber}
            expiryDate={expiryDate}
            onExpiryDateChange={setExpiryDate}
            manufactureDate={manufactureDate}
            onManufactureDateChange={setManufactureDate}
            purchaseInvoice={invoice}
            onPurchaseInvoiceChange={setInvoice}
            location={location}
            onLocationChange={setLocation}
            controlledWarning={isControlledProduct(product) ? t(lang, "pharmacyControlled") : null}
          />
        }
      />

      <ReceiveMovementPreview
        lang={lang}
        currentStock={product.stockOnHand}
        receiving={qtyN}
        unitLabel={product.baseUnit}
      />

      <ReceiveSummaryPanel
        lang={lang}
        invoiceTotalUgx={invoiceTotalUgx}
        productCount={1}
        unitsReceived={qtyN}
        supplierName={supplierName}
        businessDate={dateKeyKampala(new Date())}
        purchaseReference={invoice.trim() || undefined}
      />
    </ReceiveOperationShell>
  );
}
