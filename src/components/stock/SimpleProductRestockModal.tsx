import { useEffect, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  isPharmacyPackagingActive,
  pharmacyRestockPreview,
  type PharmacyRestockUnit,
} from "../../lib/pharmacyPackaging";
import { packLabelFromProduct, stockBreakdown } from "../../lib/sellingEngine";
import { WALK_IN_SUPPLIER_ID } from "../../lib/walkInSupplier";
import { usePosStore } from "../../store/usePosStore";
import { shouldTrackBatchesForProduct } from "../../lib/pharmacyStoreBatch";
import { dateKeyKampala } from "../../lib/datesUg";
import { ReceiveOperationShell } from "../inventory/receive/ReceiveOperationShell";
import { SupplierSelector } from "../inventory/receive/SupplierSelector";
import { PurchaseLineEditor } from "../inventory/receive/PurchaseLineEditor";
import { ReceiveMovementPreview } from "../inventory/receive/ReceiveMovementPreview";
import { ReceiveSummaryPanel } from "../inventory/receive/ReceiveSummaryPanel";
import { ReceiveFooter } from "../inventory/receive/ReceiveFooter";
import { ReceiveStatusStrip } from "../inventory/receive/ReceiveStatusStrip";
import { wizardChoiceButtonClass } from "../inventory/receive/receiveTokens";

type Props = {
  lang: Language;
  open: boolean;
  product: Product | null;
  suppliers: { id: string; name: string }[];
  onClose: () => void;
  onSave: (input: {
    productId: string;
    packQty: number;
    costPerPackUgx: number;
    supplierId: string;
    supplierName: string;
    pharmacyRestock?: {
      unit: PharmacyRestockUnit;
      invoiceTotalUgx: number;
      baseUnitsIn: number;
      costPerBaseUnitUgx: number;
    };
  }) => { ok: boolean };
};

export function SimpleProductRestockModal({ lang, open, product, suppliers, onClose, onSave }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const [packQty, setPackQty] = useState("1");
  const [packPrice, setPackPrice] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [restockUnit, setRestockUnit] = useState<PharmacyRestockUnit>("box");
  const [supplierId, setSupplierId] = useState(WALK_IN_SUPPLIER_ID);

  const pharmacyPack = product ? isPharmacyPackagingActive(product) : false;
  const pkg = product?.pharmacyPackaging;

  const unitOptions = useMemo((): { id: PharmacyRestockUnit; label: string }[] => {
    if (!pkg?.enabled) return [];
    const opts: { id: PharmacyRestockUnit; label: string }[] = [{ id: "tablet", label: pkg.baseUnit }];
    if (pkg.level1) opts.unshift({ id: "strip", label: pkg.level1.unit });
    if (pkg.level2) opts.unshift({ id: "box", label: pkg.level2.unit });
    return opts;
  }, [pkg]);

  const b = product ? stockBreakdown(product) : null;
  const packName = product
    ? pharmacyPack
      ? unitOptions.find((o) => o.id === restockUnit)?.label ?? pkg?.level2?.unit ?? pkg?.level1?.unit ?? product.baseUnit
      : packLabelFromProduct(product) ?? t(lang, "packKind_pack")
    : "";

  useEffect(() => {
    if (!open) return;
    setPackQty("1");
    setPackPrice("");
    setInvoiceTotal("");
    setSupplierId(WALK_IN_SUPPLIER_ID);
    if (product && isPharmacyPackagingActive(product)) {
      const p = product.pharmacyPackaging!;
      setRestockUnit(p.level2 ? "box" : p.level1 ? "strip" : "tablet");
    }
  }, [open, product?.id]);

  const qtyN = Math.max(0, Number(packQty.replace(/[^\d.]/g, "")) || 0);
  const invoiceN = Math.floor(Number(invoiceTotal.replace(/\D/g, "")) || 0);
  const preview = product && pharmacyPack && qtyN > 0 && invoiceN > 0 ? pharmacyRestockPreview(product, restockUnit, qtyN, invoiceN) : null;

  const piecesPerPack = product?.conversionRate && product.conversionRate > 1 ? product.conversionRate : 1;
  const addsPieces =
    pharmacyPack && preview ? preview.baseUnitsAdded : b?.hasPackTracking ? qtyN * piecesPerPack : qtyN;

  if (!open || !product) return null;

  const batchTracked = shouldTrackBatchesForProduct(
    preferences.businessType,
    preferences.pharmacyModeEnabled,
    product,
  );

  if (batchTracked) {
    return (
      <ReceiveOperationShell
        lang={lang}
        open={open}
        title={tTemplate(lang, "stockRestockProductTitle", { name: product.name })}
        warning={t(lang, "pharmacyBatchReceiveRequired")}
        onRequestClose={onClose}
        footer={
          <ReceiveFooter lang={lang} layout="single" primaryLabelKey="cancel" primaryType="button" onPrimary={onClose} />
        }
      >
        <p className="text-sm text-muted-foreground">{t(lang, "stockRestockProductHint")}</p>
      </ReceiveOperationShell>
    );
  }

  const supplierName =
    supplierId === WALK_IN_SUPPLIER_ID ? t(lang, "restockTownBuy") : suppliers.find((s) => s.id === supplierId)?.name ?? "";
  const invoiceTotalUgx = pharmacyPack ? invoiceN : qtyN * (Math.floor(Number(packPrice.replace(/\D/g, "")) || 0));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const qty = Math.max(0, Number(packQty.replace(/[^\d.]/g, "")) || 0);
    if (qty <= 0) return;

    if (pharmacyPack && preview && invoiceN > 0) {
      const r = onSave({
        productId: product.id,
        packQty: qty,
        costPerPackUgx: Math.round(invoiceN / qty),
        supplierId: supplierId === WALK_IN_SUPPLIER_ID ? WALK_IN_SUPPLIER_ID : supplierId,
        supplierName,
        pharmacyRestock: {
          unit: restockUnit,
          invoiceTotalUgx: invoiceN,
          baseUnitsIn: preview.baseUnitsAdded,
          costPerBaseUnitUgx: preview.costPerBaseUnitUgx,
        },
      });
      if (r.ok) onClose();
      return;
    }

    const cost = Math.floor(Number(packPrice.replace(/\D/g, "")) || 0);
    if (cost <= 0) return;
    const r = onSave({
      productId: product.id,
      packQty: qty,
      costPerPackUgx: cost,
      supplierId: supplierId === WALK_IN_SUPPLIER_ID ? WALK_IN_SUPPLIER_ID : supplierId,
      supplierName,
    });
    if (r.ok) onClose();
  };

  const unitSelector =
    pharmacyPack && unitOptions.length > 0 ? (
      <>
        <p className="text-sm font-bold text-foreground">{t(lang, "pharmacyRestockByUnit")}</p>
        <div className="grid grid-cols-3 gap-2">
          {unitOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRestockUnit(opt.id)}
              className={clsx(wizardChoiceButtonClass(restockUnit === opt.id), "capitalize")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </>
    ) : null;

  const previewPanel =
    preview && preview.lines.length > 0 ? (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-sm font-black text-primary">{t(lang, "pharmacyPackPreviewTitle")}</p>
        <ul className="mt-2 space-y-1 text-sm font-bold text-primary/90">
          {preview.lines.map((line, i) => (
            <li key={i}>
              = {line.count.toLocaleString()} {line.label}
            </li>
          ))}
        </ul>
        {preview.costPerBaseUnitUgx > 0 ? (
          <p className="mt-2 text-xs font-bold text-emerald-900">
            {t(lang, "pharmacyPackCostPreview")}: {preview.costPerBaseUnitUgx.toLocaleString()} UGX / {product.baseUnit}
          </p>
        ) : null}
      </div>
    ) : addsPieces > 0 && !pharmacyPack ? (
      <p className="text-sm font-bold text-primary">
        {tTemplate(lang, "stockRestockAdds", { count: String(addsPieces), unit: product.baseUnit })}
      </p>
    ) : null;

  return (
    <ReceiveOperationShell
      lang={lang}
      open={open}
      title={tTemplate(lang, "stockRestockProductTitle", { name: product.name })}
      subtitle={t(lang, "stockRestockProductHint")}
      onSubmit={onSubmit}
      onRequestClose={onClose}
      statusStrip={<ReceiveStatusStrip lang={lang} />}
      footer={<ReceiveFooter lang={lang} onCancel={onClose} primaryLabelKey="stockRestockSave" />}
    >
      <PurchaseLineEditor
        lang={lang}
        product={product}
        quantityLabel={tTemplate(lang, pharmacyPack ? "pharmacyRestockQty" : "stockRestockPackQty", {
          unit: packName,
          pack: packName,
        })}
        quantityValue={packQty}
        onQuantityChange={setPackQty}
        costLabel={
          pharmacyPack ? t(lang, "pharmacyPackTotalPaid") : tTemplate(lang, "stockRestockPackPrice", { pack: packName })
        }
        costValue={pharmacyPack ? invoiceTotal : packPrice}
        onCostChange={pharmacyPack ? setInvoiceTotal : setPackPrice}
        costPlaceholder="36000"
        unitSelector={unitSelector}
        preview={previewPanel}
      />

      <SupplierSelector
        lang={lang}
        mode="dropdown"
        suppliers={suppliers}
        supplierId={supplierId}
        onSupplierIdChange={setSupplierId}
        addSupplierHref="/stock?tab=suppliers"
      />

      <ReceiveMovementPreview
        lang={lang}
        currentStock={product.stockOnHand}
        receiving={addsPieces}
        unitLabel={product.baseUnit}
      />

      {invoiceTotalUgx > 0 ? (
        <ReceiveSummaryPanel
          lang={lang}
          invoiceTotalUgx={invoiceTotalUgx}
          productCount={1}
          unitsReceived={addsPieces}
          supplierName={supplierName}
          businessDate={dateKeyKampala(new Date())}
        />
      ) : null}
    </ReceiveOperationShell>
  );
}
