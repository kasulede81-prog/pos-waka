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
        | "quickPresetsMoneyUgx"
        | "quickPresetsQty"
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
  const [minAlert, setMinAlert] = useState("");
  const [sku, setSku] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [moneyPresets, setMoneyPresets] = useState("");
  const [qtyPresets, setQtyPresets] = useState("");

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
    setPieceOnlyStock(b.hasPackTracking ? "" : String(product.stockOnHand));
    setPrice(String(Math.max(0, Math.floor(product.sellingPricePerUnitUgx))));
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

  const previewProduct: Product = {
    ...product,
    stockOnHand: totalStock,
    baseUnit: resolveSellBaseUnit(sellUnit, sellUnitCustom),
    buyingUnit: hasPack && piecesN > 1 ? packLabel.toLowerCase() : null,
    conversionRate: hasPack && piecesN > 1 ? piecesN : null,
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const priceUgx = Math.max(0, Math.floor(Number(price.replace(/\D/g, "")) || 0));
    if (priceUgx <= 0 || !name.trim()) return;
    if (sellUnit === "custom" && !sellUnitCustom.trim()) return;
    if (hasPack && packKind === "custom" && !packCustom.trim()) return;

    const packPrice = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
    const hasTrack = hasPack && piecesN > 1;
    const buyingUnit = hasTrack ? packLabel.toLowerCase() : null;
    const conversionRate = hasTrack ? piecesN : null;
    const costPricePerUnitUgx =
      hasTrack && packPrice > 0 ? Math.floor(packPrice / piecesN) : product.costPricePerUnitUgx;

    const patch: Parameters<typeof updateProduct>[1] = {
      name: name.trim(),
      baseUnit: resolveSellBaseUnit(sellUnit, sellUnitCustom),
      buyingUnit,
      conversionRate,
      sellingPricePerUnitUgx: priceUgx,
      costPricePerUnitUgx,
      stockOnHand: totalStock,
      minimumStockAlert: Math.max(0, Math.floor(Number(minAlert.replace(/\D/g, "")) || 0)),
      category: category.trim(),
      sku: sku.trim() || product.sku,
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
          {t(lang, "stockEditProductTitle")}
        </h2>
        <span className="w-16" aria-hidden />
      </header>

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "stockEditNameLabel")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "stockEditShelfLabel")}</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list={categorySuggestions?.length ? categoryListId : undefined}
              placeholder={t(lang, "simpleAddShelfPlaceholder")}
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

          <label className="block">
            <span className="text-sm font-bold text-slate-800">
              {tTemplate(lang, "stockEditLowStockLabel", { unit: unitLabel })}
            </span>
            <input
              value={minAlert}
              onChange={(e) => setMinAlert(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              placeholder="10"
              className={inputClass}
            />
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
