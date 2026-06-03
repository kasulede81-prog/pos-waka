import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import {
  PACK_TYPE_OPTIONS,
  SELL_UNIT_OPTIONS,
  packKindLabel,
  parseSellUnitFromBaseUnit,
  resolveSellBaseUnit,
  sellUnitLabel,
  type PackKind,
  type SellUnitKind,
} from "../../lib/simpleProductWizard";
import { formatStockLabel, stockBreakdown } from "../../lib/sellingEngine";
import { usePosStore } from "../../store/usePosStore";
import { isPharmacyMode } from "../../lib/pharmacy";
import { normalizeExpiryDate } from "../../lib/pharmacyExpiry";
import { MEDICINE_FORMS, normalizeMedicineForm, normalizeMedicineStrength } from "../../lib/pharmacyMedicine";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import { PharmacyCostWarningBanner } from "../pharmacy/PharmacyCostWarningBanner";
import {
  buildPackagingFromState,
  packagingStateFromProduct,
  PharmacyPackagingFields,
  type PharmacyPackagingFieldState,
} from "./PharmacyPackagingFields";
import {
  buyingUnitFromPackaging,
  formatPharmacyStockEquivalent,
  formatPharmacyStockPrimary,
  isPharmacyPackagingActive,
} from "../../lib/pharmacyPackaging";

type Props = {
  lang: Language;
  product: Product | null;
  open: boolean;
  onClose: () => void;
  categorySuggestions?: string[];
  canPresets?: boolean;
  updateProduct: (
    productId: string,
    patch: Partial<
      Pick<
        Product,
        | "name"
        | "baseUnit"
        | "buyingUnit"
        | "conversionRate"
        | "sellingPricePerUnitUgx"
        | "costPricePerUnitUgx"
        | "stockOnHand"
        | "minimumStockAlert"
        | "category"
        | "sku"
        | "expiryDate"
        | "medicineStrength"
        | "medicineForm"
        | "quickPresetsMoneyUgx"
        | "quickPresetsQty"
        | "pharmacyPackaging"
      >
    >,
  ) => { ok: boolean; errorKey?: string };
};

const SELL_UNITS: SellUnitKind[] = ["piece", "bottle", "packet", "kg", "litre", "custom"];

function packKindFromBuyingUnit(raw: string | null | undefined): { kind: PackKind; custom: string } {
  if (!raw) return { kind: "crate", custom: "" };
  const label = raw.split("·")[0]?.trim().toLowerCase() ?? "";
  const found = PACK_TYPE_OPTIONS.find((o) => o.id === label);
  if (found) return { kind: found.id, custom: "" };
  return { kind: "custom", custom: label };
}

export function StockProductEditModal({
  lang,
  product,
  open,
  onClose,
  categorySuggestions,
  canPresets,
  updateProduct,
}: Props) {
  const categoryListId = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sellUnit, setSellUnit] = useState<SellUnitKind>("piece");
  const [sellUnitCustom, setSellUnitCustom] = useState("");
  const [hasPack, setHasPack] = useState(false);
  const [packKind, setPackKind] = useState<PackKind>("crate");
  const [packCustom, setPackCustom] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [packCount, setPackCount] = useState("");
  const [looseCount, setLooseCount] = useState("");
  const [pieceOnlyStock, setPieceOnlyStock] = useState("");
  const [price, setPrice] = useState("");
  const [buyPricePerUnit, setBuyPricePerUnit] = useState("");
  const [minAlert, setMinAlert] = useState("");
  const [sku, setSku] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [moneyPresets, setMoneyPresets] = useState("");
  const [qtyPresets, setQtyPresets] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [medicineStrength, setMedicineStrength] = useState("");
  const [medicineForm, setMedicineForm] = useState("");
  const [packagingState, setPackagingState] = useState<PharmacyPackagingFieldState>(() =>
    packagingStateFromProduct(null),
  );

  const preferences = usePosStore((s) => s.preferences);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name);
    setCategory((product.category ?? "").trim());
    const su = parseSellUnitFromBaseUnit(product.baseUnit);
    setSellUnit(su.kind);
    setSellUnitCustom(su.custom);
    const b = stockBreakdown(product);
    const pk = packKindFromBuyingUnit(product.buyingUnit);
    setHasPack(b.hasPackTracking);
    setPackKind(pk.kind);
    setPackCustom(pk.custom);
    const rate = product.conversionRate && product.conversionRate > 1 ? product.conversionRate : 24;
    setPiecesPerPack(b.hasPackTracking ? String(rate) : "");
    setPackCount(b.hasPackTracking ? String(b.fullPacks) : "");
    setLooseCount(b.hasPackTracking ? String(b.loosePieces) : "");
    setPieceOnlyStock(
      b.hasPackTracking && !isPharmacyPackagingActive(product) ? "" : String(Math.floor(product.stockOnHand)),
    );
    setPrice(String(Math.max(0, Math.floor(product.sellingPricePerUnitUgx))));
    setBuyPricePerUnit(String(Math.max(0, Math.floor(product.costPricePerUnitUgx))));
    setMinAlert(String(Math.max(0, Math.floor(product.minimumStockAlert))));
    setSku(product.sku ?? "");
    const conv = product.conversionRate && product.conversionRate > 0 ? product.conversionRate : 0;
    if (conv > 0 && product.costPricePerUnitUgx >= 0) {
      setBuyPackPrice(String(Math.floor(product.costPricePerUnitUgx * conv)));
    } else {
      setBuyPackPrice("");
    }
    setMoneyPresets((product.quickPresetsMoneyUgx ?? []).join(","));
    setQtyPresets((product.quickPresetsQty ?? []).join(","));
    setExpiryDate(product.expiryDate ?? "");
    setMedicineStrength(product.medicineStrength ?? "");
    setMedicineForm(product.medicineForm ?? "");
    const ps = packagingStateFromProduct(product.pharmacyPackaging);
    ps.sellStrip = product.pharmacyPackaging?.sell.strip ?? ps.sellStrip;
    ps.sellBox = product.pharmacyPackaging?.sell.box ?? ps.sellBox;
    setPackagingState(ps);
  }, [open, product]);

  const piecesN = Math.max(1, Math.floor(Number(piecesPerPack.replace(/[^\d.]/g, "")) || 0));
  const packsN = Math.max(0, Number(packCount.replace(/[^\d.]/g, "")) || 0);
  const looseN = Math.max(0, Number(looseCount.replace(/[^\d.]/g, "")) || 0);
  const totalStock = useMemo(() => {
    if (!hasPack) return Math.max(0, Number(pieceOnlyStock.replace(/[^\d.]/g, "")) || 0);
    return packsN * piecesN + looseN;
  }, [hasPack, pieceOnlyStock, packsN, piecesN, looseN]);

  const unitLabel = sellUnitLabel(sellUnit, lang, sellUnitCustom);
  const packLabel = packKindLabel(packKind, packCustom, lang);
  if (!open || !product) return null;

  const packagingEdit = pharmacyMode && (packagingState.enabled || isPharmacyPackagingActive(product));

  const previewPackaging =
    packagingEdit && packagingState.enabled
      ? buildPackagingFromState(packagingState, Math.max(0, Math.floor(Number(price.replace(/\D/g, "")) || 0)), product.pharmacyPackaging)
      : product.pharmacyPackaging;
  const previewStock = packagingEdit
    ? Math.max(0, Number(pieceOnlyStock.replace(/\D/g, "")) || 0)
    : totalStock;
  const previewProduct: Product = {
    ...product,
    stockOnHand: previewStock,
    baseUnit: packagingEdit && previewPackaging?.enabled ? previewPackaging.baseUnit : resolveSellBaseUnit(sellUnit, sellUnitCustom),
    buyingUnit: hasPack && piecesN > 1 && !packagingEdit ? packLabel.toLowerCase() : product.buyingUnit,
    conversionRate: hasPack && piecesN > 1 && !packagingEdit ? piecesN : product.conversionRate,
    pharmacyPackaging: previewPackaging,
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const priceUgx = Math.max(0, Math.floor(Number(price.replace(/\D/g, "")) || 0));
    const buyPerUnit = Math.max(0, Math.floor(Number(buyPricePerUnit.replace(/\D/g, "")) || 0));
    if (priceUgx <= 0 || !name.trim()) return;
    if (pharmacyMode && buyPerUnit <= 0) return;
    if (sellUnit === "custom" && !sellUnitCustom.trim()) return;
    if (hasPack && packKind === "custom" && !packCustom.trim()) return;

    const packPrice = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
    const hasTrack = hasPack && piecesN > 1;
    const buyingUnit = hasTrack ? packLabel.toLowerCase() : null;
    const conversionRate = hasTrack ? piecesN : null;
    const costPricePerUnitUgx = pharmacyMode
      ? buyPerUnit
      : hasTrack && packPrice > 0
        ? Math.floor(packPrice / piecesN)
        : product.costPricePerUnitUgx;

    let pharmacyPackaging = product.pharmacyPackaging ?? null;
    let baseUnit = resolveSellBaseUnit(sellUnit, sellUnitCustom);
    let patchBuyingUnit = buyingUnit;
    let patchConversion = conversionRate;

    if (packagingEdit && packagingState.enabled) {
      pharmacyPackaging = buildPackagingFromState(packagingState, priceUgx, product.pharmacyPackaging);
      if (pharmacyPackaging) {
        baseUnit = pharmacyPackaging.baseUnit;
        const bu = buyingUnitFromPackaging(pharmacyPackaging);
        patchBuyingUnit = bu.buyingUnit;
        patchConversion = bu.conversionRate;
        pharmacyPackaging.lowStockAlertUnit = packagingState.lowStockUnit;
      }
    }

    const patch: Parameters<typeof updateProduct>[1] = {
      name: name.trim(),
      baseUnit,
      buyingUnit: patchBuyingUnit,
      conversionRate: patchConversion,
      sellingPricePerUnitUgx: priceUgx,
      costPricePerUnitUgx,
      stockOnHand: packagingEdit ? Math.max(0, Number(pieceOnlyStock.replace(/[^\d.]/g, "")) || 0) : totalStock,
      minimumStockAlert: Math.max(0, Math.floor(Number(minAlert.replace(/\D/g, "")) || 0)),
      category: category.trim(),
      sku: sku.trim() || product.sku,
      expiryDate: pharmacyMode ? normalizeExpiryDate(expiryDate || null) : product.expiryDate ?? null,
      medicineStrength: pharmacyMode ? normalizeMedicineStrength(medicineStrength || null) : product.medicineStrength ?? null,
      medicineForm: pharmacyMode ? normalizeMedicineForm(medicineForm || null) : product.medicineForm ?? null,
      pharmacyPackaging: packagingEdit ? pharmacyPackaging : product.pharmacyPackaging ?? null,
    };

    if (canPresets) {
      patch.quickPresetsMoneyUgx = moneyPresets
        .split(",")
        .map((x) => Math.floor(Number(x.trim()) || 0))
        .filter((x) => x > 0);
      patch.quickPresetsQty = qtyPresets
        .split(",")
        .map((x) => Number(x.trim()) || 0)
        .filter((x) => x > 0);
    }

    const r = updateProduct(product.id, patch);
    if (r.ok) onClose();
  };

  const inputClass =
    "mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-lg font-bold outline-none ring-waka-300 focus:ring";

  return (
    <AppModalOverlay
      className="z-[58] flex flex-col bg-white pt-[max(0.5rem,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal
      aria-labelledby="stock-edit-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <button type="button" className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600" onClick={onClose}>
          {t(lang, "cancel")}
        </button>
        <h2 id="stock-edit-title" className="text-center text-lg font-black text-slate-900">
          {pt("stockEditProduct")}
        </h2>
        <span className="w-16" aria-hidden />
      </header>

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
          <label className="block">
            <span className="text-sm font-bold text-slate-800">{pt("stockEditName")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{pt("stockEditShelf")}</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list={categorySuggestions?.length ? categoryListId : undefined}
              placeholder={uiPlaceholder(
                lang,
                preferences.businessType,
                "simpleAddShelfPlaceholder",
                preferences.pharmacyModeEnabled,
              )}
              className={inputClass}
            />
            {categorySuggestions?.length ? (
              <datalist id={categoryListId}>
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            ) : null}
          </label>

          {pharmacyMode ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold text-slate-800">{pt("strength")}</span>
                <input
                  value={medicineStrength}
                  onChange={(e) => setMedicineStrength(e.target.value)}
                  placeholder="500mg"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">{pt("form")}</span>
                <select
                  value={medicineForm || ""}
                  onChange={(e) => setMedicineForm(e.target.value)}
                  className={inputClass}
                >
                  <option value="">{t(lang, "pharmacyFormSelect")}</option>
                  {MEDICINE_FORMS.map((form) => (
                    <option key={form} value={form}>
                      {form}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-bold text-slate-800">{t(lang, "pharmacyExpiryDateLabel")}</span>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-xs font-medium text-slate-500">{t(lang, "pharmacyExpiryDateHint")}</p>
              </label>
            </div>
          ) : null}

          {packagingEdit ? (
            <>
              <PharmacyPackagingFields
                lang={lang}
                state={packagingState}
                onChange={(patch) => setPackagingState((s) => ({ ...s, ...patch }))}
                hideTabletPrice
                showEnableToggle={!isPharmacyPackagingActive(product)}
                inputClass={inputClass}
                labelClass="block text-sm font-bold text-slate-700"
              />
              <div className="rounded-2xl border-2 border-waka-100 bg-waka-50/40 p-4">
                <label className="block text-sm font-bold text-slate-800">
                  {t(lang, "pharmacyPackStockOnHand")}
                  <input
                    value={pieceOnlyStock || String(product.stockOnHand)}
                    onChange={(e) => setPieceOnlyStock(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                {packagingState.enabled ? (
                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-black text-waka-900">
                    <p>{t(lang, "pharmacyPackStockPrimary")}: {formatPharmacyStockPrimary({ ...previewProduct, stockOnHand: Math.max(0, Number(pieceOnlyStock.replace(/\D/g, "")) || 0) })}</p>
                    {formatPharmacyStockEquivalent({ ...previewProduct, stockOnHand: Math.max(0, Number(pieceOnlyStock.replace(/\D/g, "")) || 0) }) ? (
                      <p className="mt-1 whitespace-pre-line text-xs font-bold text-slate-600">
                        {t(lang, "pharmacyPackStockEquivalent")}:{"\n"}
                        {formatPharmacyStockEquivalent({ ...previewProduct, stockOnHand: Math.max(0, Number(pieceOnlyStock.replace(/\D/g, "")) || 0) })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="text-sm font-bold text-slate-800">{t(lang, "stockEditSellUnitLabel")}</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {SELL_UNITS.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setSellUnit(u)}
                      className={clsx(
                        "min-h-[48px] rounded-2xl border-2 text-sm font-black",
                        sellUnit === u ? "border-waka-500 bg-waka-600 text-white" : "border-slate-200 bg-white text-slate-900",
                      )}
                    >
                      {t(lang, SELL_UNIT_OPTIONS.find((o) => o.id === u)!.labelKey as "sellUnit_piece")}
                    </button>
                  ))}
                </div>
                {sellUnit === "custom" ? (
                  <input
                    value={sellUnitCustom}
                    onChange={(e) => setSellUnitCustom(e.target.value)}
                    placeholder={t(lang, "simpleAddSellUnitCustomPh")}
                    className={clsx(inputClass, "mt-2")}
                  />
                ) : null}
              </div>

              <div className="rounded-2xl border-2 border-slate-100 bg-slate-50/80 p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={hasPack}
                    onChange={(e) => setHasPack(e.target.checked)}
                    className="h-5 w-5 accent-waka-600"
                  />
                  <span className="text-sm font-black text-slate-900">{t(lang, "simpleAddPackToggle")}</span>
                </label>
                {hasPack ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs font-semibold text-slate-600">{t(lang, "simpleAddPackTypeLabel")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {PACK_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setPackKind(opt.id)}
                          className={clsx(
                            "min-h-[44px] rounded-xl border-2 text-xs font-black",
                            packKind === opt.id ? "border-waka-500 bg-waka-600 text-white" : "border-slate-200 bg-white",
                          )}
                        >
                          {t(lang, opt.labelKey as "packKind_crate")}
                        </button>
                      ))}
                    </div>
                    {packKind === "custom" ? (
                      <input
                        value={packCustom}
                        onChange={(e) => setPackCustom(e.target.value)}
                        placeholder={t(lang, "simpleAddPackCustomPh")}
                        className={inputClass}
                      />
                    ) : null}
                    <label className="block text-sm font-bold text-slate-800">
                      {tTemplate(lang, "simpleAddStep5Title", { unit: unitLabel, pack: packLabel })}
                      <input
                        value={piecesPerPack}
                        onChange={(e) => setPiecesPerPack(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
                        inputMode="numeric"
                        placeholder="24"
                        className={inputClass}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border-2 border-waka-100 bg-waka-50/40 p-4">
                <span className="text-sm font-bold text-slate-800">{t(lang, "stockEditStockLabel")}</span>
                {hasPack && piecesN > 1 ? (
                  <div className="mt-2 space-y-3">
                    <label className="block text-sm font-semibold text-slate-700">
                      {tTemplate(lang, "simpleAddStep6TitlePack", { pack: packLabel })}
                      <input
                        value={packCount}
                        onChange={(e) => setPackCount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                        inputMode="decimal"
                        className={inputClass}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      {tTemplate(lang, "stockEditLooseLabel", { unit: unitLabel })}
                      <input
                        value={looseCount}
                        onChange={(e) => setLooseCount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                        inputMode="decimal"
                        placeholder="0"
                        className={inputClass}
                      />
                    </label>
                  </div>
                ) : (
                  <input
                    value={pieceOnlyStock}
                    onChange={(e) => setPieceOnlyStock(e.target.value.replace(/[^\d.]/g, "").slice(0, 10))}
                    inputMode="decimal"
                    className={inputClass}
                  />
                )}
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-black text-waka-900">
                  {formatStockLabel(previewProduct)}
                </p>
              </div>
            </>
          )}

          {pharmacyMode ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block rounded-2xl border-2 border-teal-100 bg-teal-50/50 p-4">
                <span className="text-sm font-black text-teal-900">{t(lang, "pharmacyEditBuyPriceLabel")}</span>
                <input
                  value={buyPricePerUnit}
                  onChange={(e) => setBuyPricePerUnit(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  inputMode="numeric"
                  className={`${inputClass} mt-2 text-2xl font-black`}
                  required
                />
                <span className="mt-1 block text-xs font-semibold text-teal-800">
                  UGX / {previewProduct.baseUnit}
                </span>
              </label>
              <label className="block rounded-2xl border-2 border-waka-100 bg-waka-50/50 p-4">
                <span className="text-sm font-black text-waka-900">{t(lang, "pharmacyEditSellPriceLabel")}</span>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  inputMode="numeric"
                  className={`${inputClass} mt-2 text-2xl font-black`}
                  required
                />
                <span className="mt-1 block text-xs font-semibold text-waka-800">
                  UGX / {previewProduct.baseUnit}
                </span>
              </label>
            </div>
          ) : (
            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "stockEditPriceLabel")}</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="2000"
                className={`${inputClass} text-2xl font-black`}
                required
              />
              <span className="mt-1 block text-xs font-semibold text-slate-500">UGX</span>
            </label>
          )}

          {pharmacyMode ? (
            <PharmacyCostWarningBanner
              lang={lang}
              product={{
                ...previewProduct,
                sellingPricePerUnitUgx: Math.max(0, Math.floor(Number(price.replace(/\D/g, "")) || 0)),
                costPricePerUnitUgx: Math.max(0, Math.floor(Number(buyPricePerUnit.replace(/\D/g, "")) || 0)),
              }}
            />
          ) : null}

          <label className="block">
            <span className="text-sm font-bold text-slate-800">
              {packagingEdit && packagingState.enabled
                ? t(lang, "pharmacyPackLowStockLabel")
                : tTemplate(lang, "stockEditLowStockLabel", { unit: unitLabel })}
            </span>
            <div className={packagingEdit && packagingState.enabled ? "mt-2 flex gap-2" : ""}>
              <input
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                placeholder="10"
                className={packagingEdit && packagingState.enabled ? `${inputClass} flex-1` : inputClass}
              />
              {packagingEdit && packagingState.enabled ? (
                <select
                  value={packagingState.lowStockUnit}
                  onChange={(e) =>
                    setPackagingState((s) => ({
                      ...s,
                      lowStockUnit: e.target.value as PharmacyPackagingFieldState["lowStockUnit"],
                    }))
                  }
                  className={`${inputClass} w-[8.5rem] shrink-0`}
                >
                  <option value="tablet">{packagingState.baseUnit}</option>
                  {packagingState.level1Enabled ? <option value="strip">{packagingState.level1Unit}</option> : null}
                  {packagingState.level2Enabled ? <option value="box">{packagingState.level2Unit}</option> : null}
                </select>
              ) : null}
            </div>
          </label>

          <details className="rounded-2xl border border-slate-200 bg-slate-50/50 px-4 open:pb-4">
            <summary className="cursor-pointer py-3 text-sm font-black text-slate-700">{t(lang, "stockEditAdvanced")}</summary>
            <div className="space-y-3 pt-1">
              {hasPack ? (
                <label className="block text-sm font-bold text-slate-800">
                  {tTemplate(lang, "simpleAddStep8Title", { pack: packLabel })}
                  <input
                    value={buyPackPrice}
                    onChange={(e) => setBuyPackPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
              ) : null}
              <label className="block text-sm font-bold text-slate-800">
                {t(lang, "productSkuOptional")}
                <input value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
              </label>
              {canPresets ? (
                <>
                  <label className="block text-sm font-bold text-slate-700">
                    {t(lang, "tapPricesNote")}
                    <input value={moneyPresets} onChange={(e) => setMoneyPresets(e.target.value)} className={inputClass} />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    {t(lang, "tapQtyNote")}
                    <input value={qtyPresets} onChange={(e) => setQtyPresets(e.target.value)} className={inputClass} />
                  </label>
                </>
              ) : null}
            </div>
          </details>
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="submit"
            className="min-h-[56px] w-full rounded-2xl bg-waka-600 text-xl font-black text-white shadow-md active:bg-waka-700"
          >
            {t(lang, "saveProduct")}
          </button>
        </div>
      </form>
    </AppModalOverlay>
  );
}
