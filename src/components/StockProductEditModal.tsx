import { useEffect, useId, useState, type FormEvent } from "react";
import type { Language, Product, SellingMode, StockMovement } from "../types";
import { t } from "../lib/i18n";
import { formatProductPriceLabel } from "../store/usePosStore";
import { formatStockLabel } from "../lib/sellingEngine";

const SELLING_MODES: SellingMode[] = ["unit", "weighted", "portion"];

type PurchaseRow = { at: string; supplier: string; qty: number; cost: number };

type Props = {
  lang: Language;
  product: Product | null;
  open: boolean;
  onClose: () => void;
  businessUnitOptions: string[];
  canPresets: boolean;
  canPurchaseHistory: boolean;
  purchaseLines: PurchaseRow[];
  movements: StockMovement[];
  /** Distinct categories from the shop (for datalist suggestions). */
  categorySuggestions?: string[];
  updateProduct: (
    productId: string,
    patch: Partial<
      Pick<
        Product,
        | "name"
        | "sellingMode"
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

function splitBuyingUnit(raw: string | null | undefined): { pack: string; supplier: string } {
  if (!raw) return { pack: "", supplier: "" };
  const i = raw.indexOf(" · ");
  if (i === -1) return { pack: raw.trim(), supplier: "" };
  return { pack: raw.slice(0, i).trim(), supplier: raw.slice(i + 3).trim() };
}

export function StockProductEditModal({
  lang,
  product,
  open,
  onClose,
  businessUnitOptions,
  canPresets,
  canPurchaseHistory,
  purchaseLines,
  movements,
  categorySuggestions,
  updateProduct,
}: Props) {
  const categoryListId = useId();
  const [name, setName] = useState("");
  const [sellingMode, setSellingMode] = useState<SellingMode>("unit");
  const [unitPreset, setUnitPreset] = useState("piece");
  const [unitCustom, setUnitCustom] = useState("");
  const [price, setPrice] = useState("");
  const [costManual, setCostManual] = useState("");
  const [stock, setStock] = useState("");
  const [minAlert, setMinAlert] = useState("");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [boughtAs, setBoughtAs] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [piecesInside, setPiecesInside] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [moneyPresets, setMoneyPresets] = useState("");
  const [qtyPresets, setQtyPresets] = useState("");

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name);
    setSellingMode(product.sellingMode);
    const inList = businessUnitOptions.includes(product.baseUnit);
    setUnitPreset(inList ? product.baseUnit : "custom");
    setUnitCustom(inList ? "" : product.baseUnit);
    setPrice(String(Math.max(0, Math.floor(product.sellingPricePerUnitUgx))));
    setCostManual(String(Math.max(0, Math.floor(product.costPricePerUnitUgx))));
    setStock(String(product.stockOnHand));
    setMinAlert(String(Math.max(0, Math.floor(product.minimumStockAlert))));
    setCategory(product.category);
    setSku(product.sku);
    const { pack, supplier } = splitBuyingUnit(product.buyingUnit ?? null);
    setBoughtAs(pack);
    setSupplierName(supplier);
    const conv = product.conversionRate && product.conversionRate > 0 ? product.conversionRate : 0;
    if (conv > 0 && product.costPricePerUnitUgx >= 0) {
      setBuyPackPrice(String(Math.floor(product.costPricePerUnitUgx * conv)));
      setPiecesInside(String(conv));
    } else {
      setBuyPackPrice("");
      setPiecesInside("");
    }
    setMoneyPresets((product.quickPresetsMoneyUgx ?? []).join(","));
    setQtyPresets((product.quickPresetsQty ?? []).join(","));
  }, [open, product, businessUnitOptions]);

  if (!open || !product) return null;

  const packN = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
  const piecesN = Math.floor(Number(piecesInside.replace(/[^\d.]/g, "")) || 0);
  const showPackTrack = boughtAs.trim().length > 0 && packN > 0 && piecesN > 0;

  const resolveUnit = () => (unitPreset === "custom" ? unitCustom : unitPreset).trim() || "piece";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const sellUnit = resolveUnit();
    if (!sellUnit) return;
    const priceUgx = Math.max(0, Math.floor(Number(price.replace(/\D/g, "")) || 0));
    if (priceUgx <= 0) return;
    const pack = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
    const pieces = Math.floor(Number(piecesInside.replace(/[^\d.]/g, "")) || 0);
    const bought = boughtAs.trim();
    const hasTrack = bought.length > 0 && pack > 0 && pieces > 0;

    let buyingUnit: string | null;
    let conversionRate: number | null;
    let costPricePerUnitUgx: number;

    if (hasTrack) {
      buyingUnit = supplierName.trim() ? `${bought} · ${supplierName.trim()}` : bought;
      conversionRate = pieces;
      costPricePerUnitUgx = Math.floor(pack / pieces);
    } else {
      buyingUnit = null;
      conversionRate = null;
      costPricePerUnitUgx = Math.max(0, Math.floor(Number(costManual.replace(/\D/g, "")) || 0));
    }

    const money = moneyPresets
      .split(",")
      .map((x) => Math.floor(Number(x.trim()) || 0))
      .filter((x) => x > 0);
    const qty = qtyPresets
      .split(",")
      .map((x) => Number(x.trim()) || 0)
      .filter((x) => x > 0);

    const patch: Parameters<typeof updateProduct>[1] = {
      name: name.trim(),
      sellingMode,
      baseUnit: sellUnit,
      buyingUnit,
      conversionRate,
      sellingPricePerUnitUgx: priceUgx,
      costPricePerUnitUgx,
      stockOnHand: Math.max(0, Number(stock.replace(/[^\d.-]/g, "")) || 0),
      minimumStockAlert: Math.max(0, Math.floor(Number(minAlert.replace(/\D/g, "")) || 0)),
      category: category.trim(),
      sku: sku.trim() || product.sku,
    };

    if (canPresets) {
      patch.quickPresetsMoneyUgx = money;
      patch.quickPresetsQty = qty;
    }

    const r = updateProduct(product.id, patch);
    if (r.ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[58] flex flex-col bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal
      aria-labelledby="stock-edit-title"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <button type="button" className="rounded-xl px-3 py-2 text-sm font-bold text-slate-700" onClick={onClose}>
          {t(lang, "cancel")}
        </button>
        <h2 id="stock-edit-title" className="text-center text-lg font-black text-slate-900">
          {t(lang, "stockEditProductTitle")}
        </h2>
        <span className="w-16" aria-hidden />
      </header>

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            {formatProductPriceLabel(product)} · {t(lang, "stockLabel")}: {formatStockLabel(product)}
          </p>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "quickAddName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-semibold outline-none ring-waka-200 focus:ring"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "howYouSell")}</span>
            <select
              value={sellingMode}
              onChange={(e) => setSellingMode(e.target.value as SellingMode)}
              className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-900"
            >
              {SELLING_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(lang, `mode_${m}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "howYouSellUnit")}</span>
            <p className="mt-0.5 text-xs text-slate-500">{t(lang, "stockSellUnitSelectHint")}</p>
            <select
              value={unitPreset === "custom" ? "custom" : unitPreset}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") {
                  setUnitPreset("custom");
                } else {
                  setUnitPreset(v);
                  setUnitCustom("");
                }
              }}
              className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-900"
            >
              {businessUnitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              <option value="custom">{t(lang, "unitCustomOption")}</option>
            </select>
          </label>
          {unitPreset === "custom" ? (
            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "unitCustomPlaceholder")}</span>
              <input
                value={unitCustom}
                onChange={(e) => setUnitCustom(e.target.value)}
                placeholder={t(lang, "unitCustomPlaceholder")}
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            </label>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "quickAddPrice")}</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-xl font-black outline-none ring-waka-200 focus:ring"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "costPricePerUnit")}</span>
              <input
                value={costManual}
                onChange={(e) => setCostManual(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                disabled={showPackTrack}
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-xl font-black outline-none ring-waka-200 focus:ring disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "stockNowLabel")}</span>
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value.replace(/[^\d.]/g, "").slice(0, 14))}
                inputMode="decimal"
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-xl font-black outline-none ring-waka-200 focus:ring"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "warnWhenLow")}</span>
              <input
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-xl font-black outline-none ring-waka-200 focus:ring"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "posCategoryLabel")}</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list={categorySuggestions && categorySuggestions.length > 0 ? categoryListId : undefined}
              placeholder={t(lang, "categoryNewPlaceholder")}
              className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
            {categorySuggestions && categorySuggestions.length > 0 ? (
              <datalist id={categoryListId}>
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            ) : null}
          </label>

          <label className="block">
            <span className="text-sm font-bold text-slate-800">{t(lang, "productSkuOptional")}</span>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
          </label>

          <details className="rounded-2xl border-2 border-slate-200 bg-slate-50/80 px-4 open:pb-4 open:pt-2">
            <summary className="cursor-pointer py-3 text-base font-black text-slate-900">
              {t(lang, "trackBuyingProfit")} <span className="text-xs font-bold text-waka-700">{t(lang, "optional")}</span>
            </summary>
            <p className="text-xs text-slate-500">{t(lang, "trackBuyingProfitHint")}</p>
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-bold text-slate-800">
                {t(lang, "howYouBuyPack")}
                <input
                  value={boughtAs}
                  onChange={(e) => setBoughtAs(e.target.value)}
                  placeholder={t(lang, "howYouBuyPackPh")}
                  className="mt-1 min-h-[44px] w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-base"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-bold text-slate-800">
                  {t(lang, "buyingPackPriceLabel")}
                  <input
                    value={buyPackPrice}
                    onChange={(e) => setBuyPackPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className="mt-1 min-h-[44px] w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-base font-bold"
                  />
                </label>
                <label className="block text-sm font-bold text-slate-800">
                  {t(lang, "howManyInsideLabel")}
                  <input
                    value={piecesInside}
                    onChange={(e) => setPiecesInside(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                    inputMode="decimal"
                    className="mt-1 min-h-[44px] w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-base font-bold"
                  />
                </label>
              </div>
              <label className="block text-sm font-bold text-slate-800">
                {t(lang, "supplierOptionalLabel")}
                <input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder={t(lang, "supplierOptionalPh")}
                  className="mt-1 min-h-[44px] w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-base"
                />
              </label>
            </div>
          </details>

          {canPresets ? (
            <div className="space-y-3 rounded-2xl border-2 border-dashed border-slate-300 p-4">
              <p className="text-sm font-black text-slate-800">{t(lang, "saveTapPrices")}</p>
              <label className="block text-sm font-bold text-slate-700">{t(lang, "tapPricesNote")}</label>
              <input
                value={moneyPresets}
                onChange={(e) => setMoneyPresets(e.target.value)}
                className="w-full rounded-xl border-2 px-3 py-2 text-lg"
              />
              <label className="block text-sm font-bold text-slate-700">{t(lang, "tapQtyNote")}</label>
              <input
                value={qtyPresets}
                onChange={(e) => setQtyPresets(e.target.value)}
                className="w-full rounded-xl border-2 px-3 py-2 text-lg"
              />
            </div>
          ) : null}

          {canPurchaseHistory ? (
            <details className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2">
              <summary className="cursor-pointer text-sm font-black text-slate-800">{t(lang, "stockHistoryInEditor")}</summary>
              <div className="mt-2 space-y-3 text-xs">
                <div>
                  <p className="font-bold text-slate-600">{t(lang, "productPurchaseHistory")}</p>
                  <ul className="mt-1 space-y-1 text-slate-700">
                    {purchaseLines.map((row, i) => (
                      <li key={i}>
                        {new Date(row.at).toLocaleDateString()} · {row.supplier} · {row.qty} pack @ UGX {row.cost.toLocaleString()}
                      </li>
                    ))}
                    {purchaseLines.length === 0 ? <li className="text-slate-500">{t(lang, "noPurchaseLinesYet")}</li> : null}
                  </ul>
                </div>
                <div>
                  <p className="font-bold text-slate-600">{t(lang, "stockMovementTitle")}</p>
                  <ul className="mt-1 space-y-1 text-slate-700">
                    {movements.map((mv) => (
                      <li key={mv.id}>
                        {new Date(mv.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {mv.summary} ({mv.deltaBaseUnits >= 0 ? "+" : ""}
                        {mv.deltaBaseUnits})
                      </li>
                    ))}
                    {movements.length === 0 ? <li className="text-slate-500">{t(lang, "noStockMovementsYet")}</li> : null}
                  </ul>
                </div>
              </div>
            </details>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="submit"
            className="w-full min-h-[52px] rounded-2xl bg-waka-600 py-3 text-lg font-black text-white shadow-md active:bg-waka-700"
          >
            {t(lang, "saveProduct")}
          </button>
        </div>
      </form>
    </div>
  );
}
