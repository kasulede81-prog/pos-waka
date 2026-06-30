import { useEffect, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import {
  isPharmacyPackagingActive,
  pharmacyRestockPreview,
  type PharmacyRestockUnit,
} from "../../lib/pharmacyPackaging";
import { packLabelFromProduct, stockBreakdown } from "../../lib/sellingEngine";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../../lib/walkInSupplier";

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
  const [packQty, setPackQty] = useState("1");
  const [packPrice, setPackPrice] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [restockUnit, setRestockUnit] = useState<PharmacyRestockUnit>("box");
  const [supplierId, setSupplierId] = useState(WALK_IN_SUPPLIER_ID);

  const pharmacyPack = product ? isPharmacyPackagingActive(product) : false;
  const pkg = product?.pharmacyPackaging;

  const unitOptions = useMemo((): { id: PharmacyRestockUnit; label: string }[] => {
    if (!pkg?.enabled) return [];
    const opts: { id: PharmacyRestockUnit; label: string }[] = [
      { id: "tablet", label: pkg.baseUnit },
    ];
    if (pkg.level1) opts.unshift({ id: "strip", label: pkg.level1.unit });
    if (pkg.level2) opts.unshift({ id: "box", label: pkg.level2.unit });
    return opts;
  }, [pkg]);

  const b = product ? stockBreakdown(product) : null;
  const packName = product
    ? pharmacyPack
      ? unitOptions.find((o) => o.id === restockUnit)?.label ??
        pkg?.level2?.unit ??
        pkg?.level1?.unit ??
        product.baseUnit
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
  const preview = product && pharmacyPack && qtyN > 0 && invoiceN > 0
    ? pharmacyRestockPreview(product, restockUnit, qtyN, invoiceN)
    : null;

  const piecesPerPack = product?.conversionRate && product.conversionRate > 1 ? product.conversionRate : 1;
  const addsPieces = pharmacyPack && preview
    ? preview.baseUnitsAdded
    : b?.hasPackTracking
      ? qtyN * piecesPerPack
      : qtyN;

  if (!open || !product) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const qty = Math.max(0, Number(packQty.replace(/[^\d.]/g, "")) || 0);
    if (qty <= 0) return;
    const walkIn = isWalkInSupplierId(supplierId);
    const supplierName = walkIn ? t(lang, "restockTownBuy") : suppliers.find((s) => s.id === supplierId)?.name ?? "";

    if (pharmacyPack && preview && invoiceN > 0) {
      const r = onSave({
        productId: product.id,
        packQty: qty,
        costPerPackUgx: Math.round(invoiceN / qty),
        supplierId: walkIn ? WALK_IN_SUPPLIER_ID : supplierId,
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
      supplierId: walkIn ? WALK_IN_SUPPLIER_ID : supplierId,
      supplierName,
    });
    if (r.ok) onClose();
  };

  return (
    <AppModalOverlay className="z-[60] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal onClick={onClose}>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-t-[1.75rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-stone-900">
          {tTemplate(lang, "stockRestockProductTitle", { name: product.name })}
        </h2>
        <p className="mt-1 text-sm text-stone-600">{t(lang, "stockRestockProductHint")}</p>

        {pharmacyPack && unitOptions.length > 0 ? (
          <>
            <p className="mt-4 text-sm font-bold text-stone-700">{t(lang, "pharmacyRestockByUnit")}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {unitOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRestockUnit(opt.id)}
                  className={clsx(
                    "min-h-[48px] rounded-2xl border-2 text-sm font-black capitalize",
                    restockUnit === opt.id ? "border-waka-500 bg-waka-600 text-white" : "border-stone-200 bg-white text-stone-900",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <label className="mt-4 block text-sm font-bold text-stone-800">
          {tTemplate(lang, pharmacyPack ? "pharmacyRestockQty" : "stockRestockPackQty", { unit: packName, pack: packName })}
          <input
            value={packQty}
            onChange={(e) => setPackQty(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
            inputMode="decimal"
            className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black"
          />
        </label>

        {pharmacyPack ? (
          <label className="mt-4 block text-sm font-bold text-stone-800">
            {t(lang, "pharmacyPackTotalPaid")}
            <input
              value={invoiceTotal}
              onChange={(e) => setInvoiceTotal(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              placeholder="36000"
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black"
            />
          </label>
        ) : (
          <label className="mt-4 block text-sm font-bold text-stone-800">
            {tTemplate(lang, "stockRestockPackPrice", { pack: packName })}
            <input
              value={packPrice}
              onChange={(e) => setPackPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              placeholder="36000"
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-2xl font-black"
            />
          </label>
        )}

        {preview && preview.lines.length > 0 ? (
          <div className="mt-4 rounded-2xl border border-waka-200 bg-waka-50 p-4">
            <p className="text-sm font-black text-waka-900">{t(lang, "pharmacyPackPreviewTitle")}</p>
            <ul className="mt-2 space-y-1 text-sm font-bold text-waka-800">
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
          <p className="mt-2 text-sm font-bold text-waka-800">
            {tTemplate(lang, "stockRestockAdds", { count: String(addsPieces), unit: product.baseUnit })}
          </p>
        ) : null}

        <label className="mt-4 block text-sm font-bold text-stone-800">
          {t(lang, "restockSupplier")}
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 bg-white px-3 text-base font-bold"
          >
            <option value={WALK_IN_SUPPLIER_ID}>{t(lang, "restockTownBuy")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button type="submit" className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white">
            {t(lang, "stockRestockSave")}
          </button>
        </div>
      </form>
    </AppModalOverlay>
  );
}
