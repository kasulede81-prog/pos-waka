import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { buildRestockSuggestions } from "../lib/restockSuggestions";
import type { Language, Product, SellingMode } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { formatProductPriceLabel } from "../store/usePosStore";
import { formatStockLabel } from "../lib/sellingEngine";
import { inferFromProductName } from "../lib/smartProductGuess";
import { starterPackForBusinessType, type StarterLine } from "../data/starterPacks";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

const modes: SellingMode[] = ["unit", "weighted", "portion"];

type BulkRow = { name: string; price: string; stock: string };

function emptyBulkRows(n: number): BulkRow[] {
  return Array.from({ length: n }, () => ({ name: "", price: "", stock: "" }));
}

type StarterRowState = StarterLine & { enabled: boolean; priceStr: string; stockStr: string };

export function StockPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canRemove = hasPermission(actor.role, "products.remove");
  const canAdjust = hasPermission(actor.role, "stock.adjust");
  const canAdd = hasPermission(actor.role, "products.add");
  const canPresets = hasPermission(actor.role, "products.edit_presets");
  const canSell = hasPermission(actor.role, "pos.sell");
  const canRestock = hasPermission(actor.role, "purchases.record");
  const canSuppliers = hasPermission(actor.role, "suppliers.view");
  const canPurchaseHistory = hasPermission(actor.role, "purchases.view");

  const products = usePosStore((s) => s.products);
  const sales = usePosStore((s) => s.sales);
  const purchases = usePosStore((s) => s.purchases);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const preferences = usePosStore((s) => s.preferences);

  const purchaseLinesByProduct = useMemo(() => {
    const m = new Map<string, Array<{ at: string; supplier: string; qty: number; cost: number }>>();
    for (const pur of purchases) {
      for (const ln of pur.lines) {
        const arr = m.get(ln.productId) ?? [];
        if (arr.length < 8) {
          arr.push({
            at: pur.createdAt,
            supplier: pur.supplierName,
            qty: ln.qtyBuyingUnits,
            cost: ln.costPerBuyingUnitUgx,
          });
        }
        m.set(ln.productId, arr);
      }
    }
    return m;
  }, [purchases]);

  const movementsByProduct = useMemo(() => {
    const m = new Map<string, typeof stockMovements>();
    for (const mv of stockMovements) {
      const arr = m.get(mv.productId) ?? [];
      if (arr.length < 12) arr.push(mv);
      m.set(mv.productId, arr);
    }
    return m;
  }, [stockMovements]);

  const addProduct = usePosStore((s) => s.addProduct);
  const quickAddProduct = usePosStore((s) => s.quickAddProduct);
  const bulkQuickAddProducts = usePosStore((s) => s.bulkQuickAddProducts);
  const removeProduct = usePosStore((s) => s.removeProduct);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const updateProductQuickPresets = usePosStore((s) => s.updateProductQuickPresets);

  const [quickOpen, setQuickOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [qaName, setQaName] = useState("");
  const [qaPrice, setQaPrice] = useState("");
  const [qaStock, setQaStock] = useState("");

  const [starterRows, setStarterRows] = useState<StarterRowState[]>([]);

  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => emptyBulkRows(10));

  const [name, setName] = useState("");
  const [sellingMode, setSellingMode] = useState<SellingMode>("unit");
  const [baseUnit, setBaseUnit] = useState("ea");
  const [buyingUnit, setBuyingUnit] = useState("");
  const [conversionRate, setConversionRate] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [stock, setStock] = useState("");
  const [minAlert, setMinAlert] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [moneyStr, setMoneyStr] = useState("");
  const [qtyStr, setQtyStr] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);

  const guessPreview = useMemo(() => {
    const n = qaName.trim();
    if (!n) return null;
    return inferFromProductName(n);
  }, [qaName]);

  const openStarter = () => {
    const pack = starterPackForBusinessType(preferences.businessType);
    setStarterRows(
      pack.map((line) => ({
        ...line,
        enabled: true,
        priceStr: String(line.defaultPriceUgx),
        stockStr: String(line.defaultStock),
      })),
    );
    setStarterOpen(true);
  };

  const submitQuick = (e: FormEvent) => {
    e.preventDefault();
    const price = Math.floor(Number(qaPrice) || 0);
    if (price < 0) return;
    const r = quickAddProduct({
      name: qaName,
      priceUgx: price,
      stockQty: Number(qaStock) || 0,
      category: t(lang, "generalCategory"),
    });
    if (!r.ok) return;
    setQaName("");
    setQaPrice("");
    setQaStock("");
    setQuickOpen(false);
  };

  const applyStarter = () => {
    const cat = t(lang, "generalCategory");
    for (const row of starterRows) {
      if (!row.enabled) continue;
      const price = Math.max(0, Math.floor(Number(row.priceStr) || 0));
      const st = Math.max(0, Number(row.stockStr) || 0);
      const displayName = t(lang, row.nameKey);
      quickAddProduct({
        name: displayName,
        priceUgx: price,
        stockQty: st,
        category: cat,
        inferName: row.inferName,
        sellingMode: row.sellingMode,
        baseUnit: row.baseUnit,
      });
    }
    setStarterOpen(false);
  };

  const submitBulk = () => {
    const cat = t(lang, "generalCategory");
    const rows = bulkRows
      .map((r) => ({
        name: r.name.trim(),
        priceUgx: Math.floor(Number(r.price) || 0),
        stockQty: Number(r.stock) || 0,
        category: cat,
      }))
      .filter((r) => r.name.length > 0 && r.priceUgx > 0);
    bulkQuickAddProducts(rows);
    setBulkRows(emptyBulkRows(10));
    setBulkOpen(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const conv = conversionRate.trim() ? Number(conversionRate) : null;
    addProduct({
      name: name.trim(),
      sellingMode,
      baseUnit: baseUnit.trim() || "ea",
      buyingUnit: buyingUnit.trim() || null,
      conversionRate: conv !== null && Number.isFinite(conv) && conv > 0 ? conv : null,
      sellingPricePerUnitUgx: Math.max(0, Math.floor(Number(sellPrice) || 0)),
      costPricePerUnitUgx: Math.max(0, Math.floor(Number(costPrice) || 0)),
      stockOnHand: Math.max(0, Number(stock) || 0),
      minimumStockAlert: Math.max(0, Number(minAlert) || 0),
      category: t(lang, "generalCategory"),
      sku: `SKU-${Date.now()}`,
    });
    setName("");
    setSellingMode("unit");
    setBaseUnit("ea");
    setBuyingUnit("");
    setConversionRate("");
    setSellPrice("");
    setCostPrice("");
    setStock("");
    setMinAlert("");
  };

  const openEditPresets = (p: Product) => {
    setEditId(p.id);
    setMoneyStr((p.quickPresetsMoneyUgx ?? []).join(","));
    setQtyStr((p.quickPresetsQty ?? []).join(","));
  };

  const savePresets = (productId: string) => {
    const money = moneyStr
      .split(",")
      .map((x) => Math.floor(Number(x.trim()) || 0))
      .filter((x) => x > 0);
    const qty = qtyStr
      .split(",")
      .map((x) => Number(x.trim()) || 0)
      .filter((x) => x > 0);
    updateProductQuickPresets(productId, {
      quickPresetsMoneyUgx: money,
      quickPresetsQty: qty,
    });
    setEditId(null);
  };

  const openDuplicateToQuick = (p: Product) => {
    setQaName(p.name);
    setQaPrice(String(Math.floor(p.sellingPricePerUnitUgx)));
    setQaStock(String(p.stockOnHand));
    setQuickOpen(true);
  };

  const confirmRemove = (id: string) => {
    if (!canRemove) return;
    removeProduct(id);
    setRemoveId(null);
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-3xl font-black text-slate-900">{t(lang, "stockTitle")}</h1>
        <p className="mt-1 text-lg text-slate-600">{t(lang, "stockChangeTitle")}</p>
      </div>

      {(canRestock || canSuppliers) && products.length > 0 ? (
        <section className="rounded-3xl border-2 border-emerald-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-wide text-emerald-900">{t(lang, "stockRestockLinks")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canRestock ? (
              <Link
                to="/restock"
                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm"
              >
                {t(lang, "stockGoRestock")}
              </Link>
            ) : null}
            {canSuppliers ? (
              <Link
                to="/suppliers"
                className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-black text-emerald-950"
              >
                {t(lang, "stockGoSuppliers")}
              </Link>
            ) : null}
          </div>
          {canPurchaseHistory ? (
            <>
              <p className="mt-4 text-sm font-black text-slate-800">{t(lang, "restockIdeasTitle")}</p>
              <ul className="mt-2 space-y-1 text-sm font-semibold text-slate-700">
                {buildRestockSuggestions(lang, products, sales, purchases).map((s, i) => (
                  <li key={i}>· {s}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {products.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-6 text-center shadow-sm">
          <p className="text-2xl font-black text-slate-900">{t(lang, "stockEmptyTitle")}</p>
          <p className="mt-2 text-lg text-slate-600">{t(lang, "stockEmptySub")}</p>
          <p className="mt-1 text-base font-semibold text-emerald-800">{t(lang, "stockEmptyHint")}</p>
          {canAdd ? (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setQuickOpen(true)}
                className="rounded-3xl bg-emerald-600 px-6 py-5 text-xl font-black text-white shadow-lg active:scale-[0.99]"
              >
                {t(lang, "quickAddOpen")}
              </button>
              <button
                type="button"
                onClick={openStarter}
                className="rounded-3xl border-2 border-emerald-300 bg-white px-6 py-5 text-xl font-black text-emerald-900"
              >
                {t(lang, "starterPackOpen")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canAdd && products.length > 0 ? (
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setQuickOpen(true)}
          className="min-h-[72px] rounded-3xl bg-emerald-600 py-4 text-lg font-black text-white shadow-md active:bg-emerald-700"
        >
          {t(lang, "quickAddOpen")}
        </button>
        <button
          type="button"
          onClick={openStarter}
          className="min-h-[72px] rounded-3xl border-2 border-slate-200 bg-white py-4 text-lg font-black text-slate-900"
        >
          {t(lang, "starterPackOpen")}
        </button>
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="min-h-[72px] rounded-3xl border-2 border-violet-200 bg-violet-50 py-4 text-lg font-black text-violet-950"
        >
          {t(lang, "bulkAddOpen")}
        </button>
      </div>
      ) : null}

      {canAdd ? (
        <>
      <button
        type="button"
        onClick={() => setShowAdvanced((x) => !x)}
        className="w-full rounded-2xl border-2 border-slate-200 py-3 text-base font-bold text-slate-700"
      >
        {showAdvanced ? t(lang, "hideExtraFields") : t(lang, "showExtraFields")}
      </button>

      {showAdvanced ? (
        <form onSubmit={submit} className="space-y-3 rounded-3xl border-2 border-slate-100 bg-white p-5">
          <p className="text-lg font-black text-slate-900">{t(lang, "addProductShort")}</p>
          <p className="text-sm text-slate-500">{t(lang, "advancedFormHint")}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, "productNamePh")}
            required
            className="w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
          />
          <label className="block text-sm font-semibold text-slate-700">
            {t(lang, "howYouSell")}
            <select
              value={sellingMode}
              onChange={(e) => setSellingMode(e.target.value as SellingMode)}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            >
              {modes.map((m) => (
                <option key={m} value={m}>
                  {t(lang, `mode_${m}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              {t(lang, "countUnit")}
              <input
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value)}
                placeholder="kg / litre / ea"
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {t(lang, "buyPackOptional")}
              <input
                value={buyingUnit}
                onChange={(e) => setBuyingUnit(e.target.value)}
                placeholder={t(lang, "buyPackPh")}
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3"
              />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            {t(lang, "conversionOptional")}
            <input
              value={conversionRate}
              onChange={(e) => setConversionRate(e.target.value)}
              placeholder="20"
              inputMode="decimal"
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              {t(lang, "sellPricePerUnit")}
              <input
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                required
                inputMode="numeric"
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {t(lang, "costPricePerUnit")}
              <input
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              {t(lang, "howMuchStock")}
              <input
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                required
                inputMode="decimal"
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              {t(lang, "warnWhenLow")}
              <input
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            </label>
          </div>
          <button type="submit" className="w-full rounded-3xl bg-slate-900 py-4 text-xl font-black text-white">
            {t(lang, "saveProduct")}
          </button>
        </form>
      ) : null}
        </>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-2xl font-black text-slate-900">{t(lang, "quickStockFix")}</h2>
        {products.length === 0 && !showAdvanced ? (
          <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-lg text-slate-600">{t(lang, "stockListEmptyHint")}</p>
        ) : null}
        {products.map((p) => (
          <article key={p.id} className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-2xl font-black text-slate-900">{p.name}</p>
                <p className="text-sm text-slate-500">
                  {t(lang, `mode_${p.sellingMode}`)} · {formatProductPriceLabel(p)}
                </p>
                <p className="mt-2 text-lg font-bold text-slate-800">
                  {t(lang, "stockLabel")}: {formatStockLabel(p)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canAdd ? (
                  <button
                    type="button"
                    className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-800"
                    onClick={() => openDuplicateToQuick(p)}
                  >
                    {t(lang, "duplicateProduct")}
                  </button>
                ) : null}
                {canRemove ? (
                  <button
                    type="button"
                    className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-800"
                    onClick={() => setRemoveId(p.id)}
                  >
                    {t(lang, "removeProduct")}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {canAdjust ? (
                <>
                  <button
                    type="button"
                    className="rounded-2xl bg-emerald-500 px-4 py-3 text-base font-black text-white shadow"
                    onClick={() => adjustStock(p.id, 10, "added")}
                  >
                    {t(lang, "addedStockBig")}
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl bg-emerald-100 px-4 py-3 text-base font-black text-emerald-900"
                    onClick={() => adjustStock(p.id, 1, "added")}
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl bg-slate-200 px-4 py-3 text-base font-black text-slate-800"
                    onClick={() => adjustStock(p.id, -1, "sold")}
                  >
                    {t(lang, "soldMinusOne")}
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-black text-amber-950"
                    onClick={() => adjustStock(p.id, -1, "damaged")}
                  >
                    {t(lang, "damaged")}
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl bg-violet-100 px-4 py-3 text-sm font-black text-violet-950"
                    onClick={() => adjustStock(p.id, -1, "home")}
                  >
                    {t(lang, "tookHome")}
                  </button>
                </>
              ) : null}
              {canSell ? (
                <Link
                  to="/pos"
                  className="inline-flex items-center rounded-2xl bg-amber-200 px-4 py-3 text-sm font-black text-amber-950"
                >
                  {t(lang, "givenOnDebt")}
                </Link>
              ) : null}
            </div>

            {canPresets && editId === p.id ? (
              <div className="mt-4 space-y-3 rounded-2xl border-2 border-dashed border-slate-300 p-4">
                <label className="block text-sm font-bold text-slate-700">{t(lang, "tapPricesNote")}</label>
                <input
                  value={moneyStr}
                  onChange={(e) => setMoneyStr(e.target.value)}
                  className="w-full rounded-xl border-2 px-3 py-2 text-lg"
                />
                <label className="block text-sm font-bold text-slate-700">{t(lang, "tapQtyNote")}</label>
                <input
                  value={qtyStr}
                  onChange={(e) => setQtyStr(e.target.value)}
                  className="w-full rounded-xl border-2 px-3 py-2 text-lg"
                />
                <div className="flex gap-2">
                  <button type="button" className="flex-1 rounded-xl bg-slate-900 py-3 font-black text-white" onClick={() => savePresets(p.id)}>
                    {t(lang, "saveTapPrices")}
                  </button>
                  <button type="button" className="rounded-xl border-2 px-4 py-3 font-bold" onClick={() => setEditId(null)}>
                    {t(lang, "cancel")}
                  </button>
                </div>
              </div>
            ) : canPresets ? (
              <button type="button" className="mt-4 text-sm font-bold text-emerald-700 underline" onClick={() => openEditPresets(p)}>
                {t(lang, "saveTapPrices")}…
              </button>
            ) : null}

            {canPurchaseHistory ? (
              <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                <summary className="cursor-pointer text-sm font-black text-slate-800">{t(lang, "stockInHistoryTitle")}</summary>
                <div className="mt-2 space-y-3 text-xs">
                  <div>
                    <p className="font-bold text-slate-600">{t(lang, "productPurchaseHistory")}</p>
                    <ul className="mt-1 space-y-1 text-slate-700">
                      {(purchaseLinesByProduct.get(p.id) ?? []).map((row, i) => (
                        <li key={i}>
                          {new Date(row.at).toLocaleDateString()} · {row.supplier} · {row.qty} pack @ UGX {row.cost.toLocaleString()}
                        </li>
                      ))}
                      {(purchaseLinesByProduct.get(p.id) ?? []).length === 0 ? (
                        <li className="text-slate-500">{t(lang, "noPurchaseLinesYet")}</li>
                      ) : null}
                    </ul>
                  </div>
                  <div>
                    <p className="font-bold text-slate-600">{t(lang, "stockMovementTitle")}</p>
                    <ul className="mt-1 space-y-1 text-slate-700">
                      {(movementsByProduct.get(p.id) ?? []).map((mv) => (
                        <li key={mv.id}>
                          {new Date(mv.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{" "}
                          · {mv.summary} ({mv.deltaBaseUnits >= 0 ? "+" : ""}
                          {mv.deltaBaseUnits})
                        </li>
                      ))}
                      {(movementsByProduct.get(p.id) ?? []).length === 0 ? (
                        <li className="text-slate-500">{t(lang, "noStockMovementsYet")}</li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              </details>
            ) : null}
          </article>
        ))}
      </section>

      {quickOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal
          onClick={() => setQuickOpen(false)}
        >
          <form
            onSubmit={submitQuick}
            className="w-full max-w-lg rounded-t-[2rem] bg-white p-6 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-2xl font-black text-slate-900">{t(lang, "quickAddTitle")}</p>
            <p className="mt-1 text-center text-sm text-slate-500">{t(lang, "quickAddSub")}</p>
            <label className="mt-6 block text-base font-bold text-slate-800">
              {t(lang, "quickAddName")}
              <input
                value={qaName}
                onChange={(e) => setQaName(e.target.value)}
                className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-4 text-xl font-semibold"
                placeholder={t(lang, "productNamePh")}
                autoFocus
              />
            </label>
            {guessPreview ? (
              <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
                {t(lang, "smartGuessHint")}: {t(lang, `mode_${guessPreview.sellingMode}`)} · {guessPreview.baseUnit}
              </p>
            ) : null}
            <label className="mt-4 block text-base font-bold text-slate-800">
              {t(lang, "quickAddPrice")}
              <input
                value={qaPrice}
                onChange={(e) => setQaPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-4 text-2xl font-black"
                placeholder="0"
                required
              />
            </label>
            <label className="mt-4 block text-base font-bold text-slate-800">
              {t(lang, "quickAddStock")}
              <input
                value={qaStock}
                onChange={(e) => setQaStock(e.target.value.replace(/[^\d.]/g, "").slice(0, 12))}
                inputMode="decimal"
                className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-4 text-2xl font-black"
                placeholder="0"
                required
              />
            </label>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" className="rounded-2xl border-2 py-4 text-lg font-bold" onClick={() => setQuickOpen(false)}>
                {t(lang, "cancel")}
              </button>
              <button type="submit" className="rounded-2xl bg-emerald-600 py-4 text-lg font-black text-white">
                {t(lang, "quickAddSave")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {starterOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal
          onClick={() => setStarterOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white p-6 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-2xl font-black text-slate-900">{t(lang, "starterPackTitle")}</p>
            <p className="mt-1 text-center text-sm text-slate-500">{t(lang, "starterPackSub")}</p>
            <ul className="mt-4 space-y-3">
              {starterRows.map((row, i) => (
                <li key={`${row.nameKey}-${i}`} className="rounded-2xl border-2 border-slate-100 p-3">
                  <label className="flex items-center gap-3 font-bold text-slate-900">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={() =>
                        setStarterRows((rows) => rows.map((r, j) => (j === i ? { ...r, enabled: !r.enabled } : r)))
                      }
                      className="h-6 w-6 accent-emerald-600"
                    />
                    <span className="flex-1 text-lg">{t(lang, row.nameKey)}</span>
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2 pl-9">
                    <label className="text-xs font-bold text-slate-600">
                      {t(lang, "quickAddPrice")}
                      <input
                        value={row.priceStr}
                        onChange={(e) =>
                          setStarterRows((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, priceStr: e.target.value.replace(/\D/g, "").slice(0, 10) } : r)),
                          )
                        }
                        inputMode="numeric"
                        className="mt-1 w-full rounded-xl border-2 px-2 py-2 text-lg font-black"
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-600">
                      {t(lang, "quickAddStock")}
                      <input
                        value={row.stockStr}
                        onChange={(e) =>
                          setStarterRows((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, stockStr: e.target.value.replace(/[^\d.]/g, "").slice(0, 10) } : r,
                            ),
                          )
                        }
                        inputMode="decimal"
                        className="mt-1 w-full rounded-xl border-2 px-2 py-2 text-lg font-black"
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" className="rounded-2xl border-2 py-4 text-lg font-bold" onClick={() => setStarterOpen(false)}>
                {t(lang, "cancel")}
              </button>
              <button type="button" className="rounded-2xl bg-emerald-600 py-4 text-lg font-black text-white" onClick={applyStarter}>
                {t(lang, "starterPackApply")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal
          onClick={() => setBulkOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-2xl font-black text-slate-900">{t(lang, "bulkAddTitle")}</p>
            <p className="mt-1 text-center text-sm text-slate-500">{t(lang, "bulkAddSub")}</p>
            <div className="mt-4 space-y-2">
              <div className="grid grid-cols-12 gap-1 text-xs font-bold uppercase text-slate-500">
                <span className="col-span-5">{t(lang, "quickAddName")}</span>
                <span className="col-span-3">{t(lang, "quickAddPrice")}</span>
                <span className="col-span-4">{t(lang, "quickAddStock")}</span>
              </div>
              {bulkRows.map((row, i) => (
                <div key={i} className="grid grid-cols-12 gap-1">
                  <input
                    value={row.name}
                    onChange={(e) =>
                      setBulkRows((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                    }
                    className="col-span-5 rounded-xl border-2 px-2 py-3 text-base"
                    placeholder="…"
                  />
                  <input
                    value={row.price}
                    onChange={(e) =>
                      setBulkRows((rows) => rows.map((r, j) => (j === i ? { ...r, price: e.target.value.replace(/\D/g, "") } : r)))
                    }
                    inputMode="numeric"
                    className="col-span-3 rounded-xl border-2 px-2 py-3 text-base font-bold"
                    placeholder="UGX"
                  />
                  <input
                    value={row.stock}
                    onChange={(e) =>
                      setBulkRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, stock: e.target.value.replace(/[^\d.]/g, "") } : r)),
                      )
                    }
                    inputMode="decimal"
                    className="col-span-4 rounded-xl border-2 px-2 py-3 text-base font-bold"
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-2xl border-2 py-3 text-sm font-bold text-slate-700"
              onClick={() => setBulkRows((r) => [...r, ...emptyBulkRows(5)])}
            >
              {t(lang, "bulkAddMoreRows")}
            </button>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" className="rounded-2xl border-2 py-4 text-lg font-bold" onClick={() => setBulkOpen(false)}>
                {t(lang, "cancel")}
              </button>
              <button type="button" className="rounded-2xl bg-violet-600 py-4 text-lg font-black text-white" onClick={submitBulk}>
                {t(lang, "bulkAddSave")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
          <div className="max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <p className="text-lg font-black text-slate-900">{t(lang, "removeProductConfirm")}</p>
            <div className="mt-6 flex gap-3">
              <button type="button" className="flex-1 rounded-2xl border-2 py-3 font-bold" onClick={() => setRemoveId(null)}>
                {t(lang, "cancel")}
              </button>
              <button type="button" className="flex-1 rounded-2xl bg-rose-600 py-3 font-black text-white" onClick={() => confirmRemove(removeId)}>
                {t(lang, "removeProduct")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
