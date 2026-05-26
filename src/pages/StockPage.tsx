import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { buildRestockSuggestions } from "../lib/restockSuggestions";
import type { Language, Product } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isLowStock } from "../lib/sellingEngine";
import { inferFromProductName } from "../lib/smartProductGuess";
import { starterPackForBusinessType, type StarterLine } from "../data/starterPacks";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { maxProductsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { StockProductEditModal } from "../components/StockProductEditModal";
import { ProductLockedModal } from "../components/ProductLockedModal";
import { isProductPlanLocked, lockedProductIds } from "../lib/productPlanLock";
import { SimpleAddProductWizard } from "../components/stock/SimpleAddProductWizard";
import { QuickAddProductFields } from "../components/stock/QuickAddProductFields";
import { StockListToolbar } from "../components/stock/StockListToolbar";
import { StockProductCard } from "../components/stock/StockProductCard";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";
import type { BuiltWizardProduct } from "../lib/simpleProductWizard";
import {
  costPerUnitFromPackAndStock,
  resolveQuickAddSellUnit,
  sellUnitPresetFromBaseUnit,
  sellingModeFromSellUnit,
} from "../lib/quickAddProductForm";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  normalizedCategoryKey,
  productMatchesCategoryFilter,
} from "../lib/productCategories";

const UNIT_PRESETS: Record<string, string[]> = {
  kiosk_duka: ["piece", "packet", "bottle", "crate"],
  restaurant: ["plate", "cup", "litre", "tray"],
  hardware: ["meter", "roll", "box"],
  pharmacy: ["tablet", "strip", "bottle"],
  boutique: ["pair", "pack", "piece"],
  default: ["piece", "kg", "gram", "litre", "bottle", "packet", "box", "tray", "crate", "sack", "bale", "roll", "pair", "meter", "carton", "bundle", "dozen", "tin", "plate", "cup"],
};

type StarterRowState = StarterLine & { enabled: boolean; priceStr: string; stockStr: string };

export function StockPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot } = useSubscription();
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
  const currentTier = resolveEffectivePlanTier(snapshot);
  const productLimit = maxProductsForTier(currentTier);
  const unlockedProducts = useMemo(
    () => (productLimit === null ? products : products.slice(0, productLimit)),
    [products, productLimit],
  );
  const lockedIds = useMemo(() => lockedProductIds(products, productLimit), [products, productLimit]);
  const lockedProductCount = lockedIds.size;
  const [productLockedOpen, setProductLockedOpen] = useState(false);
  const freeProductLimitReached = productLimit !== null && products.length >= productLimit;
  const productSlotsLeft = productLimit === null ? null : Math.max(0, productLimit - products.length);

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

  const quickAddProduct = usePosStore((s) => s.quickAddProduct);
  const removeProduct = usePosStore((s) => s.removeProduct);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const updateProduct = usePosStore((s) => s.updateProduct);

  const [quickOpen, setQuickOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const [qaName, setQaName] = useState("");
  const [qaUnitPreset, setQaUnitPreset] = useState("piece");
  const [qaUnitCustom, setQaUnitCustom] = useState("");
  const [qaPrice, setQaPrice] = useState("");
  const [qaStock, setQaStock] = useState("");
  const [qaCategory, setQaCategory] = useState("");
  const [qaBuyPackTotal, setQaBuyPackTotal] = useState("");

  const [starterRows, setStarterRows] = useState<StarterRowState[]>([]);
  const [showRestockIdeas, setShowRestockIdeas] = useState(false);


  const navigate = useNavigate();
  const [listQuery, setListQuery] = useState("");
  const [listSort, setListSort] = useState<"name_az" | "name_za" | "stock_low" | "updated">("name_az");
  const [listFilter, setListFilter] = useState<"all" | "low">("all");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [stockGroupByCategoryOverride, setStockGroupByCategoryOverride] = useState<boolean | null>(null);

  const guessPreview = useMemo(() => {
    const n = qaName.trim();
    if (!n) return null;
    return inferFromProductName(n);
  }, [qaName]);

  const businessUnitOptions = useMemo(() => {
    const typed = (preferences.businessType ?? "default") as string;
    return UNIT_PRESETS[typed] ?? UNIT_PRESETS.default;
  }, [preferences.businessType]);

  const defaultGroupByCategory = products.length > 12;
  const groupByCategory = stockGroupByCategoryOverride ?? defaultGroupByCategory;

  const stockCategoryPicklist = useMemo(() => distinctTrimmedCategories(products), [products]);
  const stockHasUncategorized = useMemo(() => products.some((p) => !normalizedCategoryKey(p)), [products]);

  const listableProducts = useMemo(() => {
    let list = [...products];
    const q = listQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const haystack = [p.name, p.category, p.baseUnit, p.sku].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    if (listFilter === "low") list = list.filter((p) => isLowStock(p));
    list = list.filter((p) => productMatchesCategoryFilter(p, stockCategoryFilter));
    return [...list].sort((a, b) => {
      if (listSort === "name_az") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (listSort === "name_za") return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
      if (listSort === "stock_low") {
        const d = a.stockOnHand - b.stockOnHand;
        return d !== 0 ? d : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [products, listQuery, listFilter, listSort, stockCategoryFilter]);

  const lowStockCount = useMemo(() => unlockedProducts.filter((p) => isLowStock(p)).length, [unlockedProducts]);

  const categoryGroups = useMemo(() => {
    if (!groupByCategory) return null;
    const m = new Map<string, Product[]>();
    for (const p of listableProducts) {
      const g = normalizedCategoryKey(p) || UNCATEGORIZED_SENTINEL;
      const arr = m.get(g) ?? [];
      arr.push(p);
      m.set(g, arr);
    }
    const keys = [...m.keys()].sort((a, b) => {
      if (a === UNCATEGORIZED_SENTINEL) return 1;
      if (b === UNCATEGORIZED_SENTINEL) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
    return { keys, map: m };
  }, [listableProducts, groupByCategory]);

  if (!hasPermission(actor.role, "back_office.access")) {
    return <Navigate to="/" replace />;
  }

  const openStarter = () => {
    if (freeProductLimitReached) return;
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
    if (freeProductLimitReached) return;
    const price = Math.floor(Number(qaPrice) || 0);
    if (price < 0) return;
    const sellUnit = resolveQuickAddSellUnit(qaUnitPreset, qaUnitCustom);
    const sellingMode = sellingModeFromSellUnit(sellUnit);
    const stockQty = Number(qaStock.replace(/[^\d.]/g, "")) || 0;
    const packTotal = Math.floor(Number(qaBuyPackTotal.replace(/\D/g, "")) || 0);
    const costPerSell = costPerUnitFromPackAndStock(packTotal, stockQty);
    const r = quickAddProduct({
      name: qaName,
      priceUgx: price,
      stockQty,
      category: qaCategory.trim() || t(lang, "generalCategory"),
      baseUnit: sellUnit,
      sellingMode,
      buyingUnit: costPerSell !== undefined ? "pack" : undefined,
      conversionRate: costPerSell !== undefined ? stockQty : undefined,
      costPricePerUnitUgx: costPerSell,
    });
    if (!r.ok) return;
    setQaName("");
    setQaUnitPreset("piece");
    setQaUnitCustom("");
    setQaPrice("");
    setQaStock("");
    setQaCategory("");
    setQaBuyPackTotal("");
    setQuickOpen(false);
  };

  const openAddProductSheet = () => {
    if (freeProductLimitReached) return;
    setQuickOpen(true);
  };

  const applyStarter = () => {
    const cat = t(lang, "generalCategory");
    let left = productSlotsLeft ?? Number.POSITIVE_INFINITY;
    for (const row of starterRows) {
      if (left <= 0) break;
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
      left -= 1;
    }
    setStarterOpen(false);
  };

  const saveFromSimpleWizard = (built: BuiltWizardProduct | null): boolean => {
    if (!built || freeProductLimitReached) return false;
    const r = quickAddProduct({
      name: built.name,
      priceUgx: built.priceUgx,
      stockQty: built.stockQty,
      category: built.category || t(lang, "generalCategory"),
      sellingMode: built.sellingMode,
      baseUnit: built.baseUnit,
      buyingUnit: built.buyingUnit ?? null,
      conversionRate: built.conversionRate ?? null,
      costPricePerUnitUgx: built.costPricePerUnitUgx ?? null,
      quickPresetsMoneyUgx: built.quickPresetsMoneyUgx,
      quickPresetsQty: built.quickPresetsQty,
      inferName: built.inferName,
    });
    return r.ok;
  };

  const openDuplicateToQuick = (p: Product) => {
    if (freeProductLimitReached) return;
    setQaName(`${p.name} (2)`);
    setQaCategory((p.category ?? "").trim());
    const preset = sellUnitPresetFromBaseUnit(p.baseUnit);
    setQaUnitPreset(preset);
    setQaUnitCustom(preset === "other" ? p.baseUnit : "");
    setQaPrice(String(Math.floor(p.sellingPricePerUnitUgx)));
    setQaStock(String(p.stockOnHand));
    setQaBuyPackTotal(
      p.stockOnHand > 0 && p.costPricePerUnitUgx > 0
        ? String(Math.floor(p.costPricePerUnitUgx * p.stockOnHand))
        : "",
    );
    setQuickOpen(true);
  };

  const confirmRemove = (id: string) => {
    if (!canRemove) return;
    removeProduct(id);
    setRemoveId(null);
  };

  const handleRowAction = (p: Product, action: string) => {
    if (isProductPlanLocked(p.id, lockedIds)) {
      setProductLockedOpen(true);
      return;
    }
    switch (action) {
      case "edit":
        if (canAdd) setEditProduct(p);
        break;
      case "add10":
        if (canAdjust) adjustStock(p.id, 10, "added");
        break;
      case "add1":
        if (canAdjust) adjustStock(p.id, 1, "added");
        break;
      case "sold1":
        if (canAdjust) adjustStock(p.id, -1, "sold");
        break;
      case "damaged1":
        if (canAdjust) adjustStock(p.id, -1, "damaged");
        break;
      case "home1":
        if (canAdjust) adjustStock(p.id, -1, "home");
        break;
      case "duplicate":
        if (canAdd) openDuplicateToQuick(p);
        break;
      case "remove":
        if (canRemove) setRemoveId(p.id);
        break;
      case "sell":
        if (canSell) navigate("/pos", { state: { preferProductId: p.id } });
        break;
      default:
        break;
    }
  };

  return (
    <div className="space-y-5 pb-4">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{t(lang, "stockTitle")}</h1>
          <p className="mt-1 text-base text-slate-600">{t(lang, "stockPageSub")}</p>
          {unlockedProducts.length > 0 ? (
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {tTemplate(lang, "stockListCount", { shown: String(listableProducts.length), total: String(products.length) })}
              {lowStockCount > 0 ? (
                <span className="text-rose-700">
                  {" "}
                  · {tTemplate(lang, "stockLowStockCount", { count: String(lowStockCount) })}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {canAdd ? (
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={openAddProductSheet}
            className="w-full shrink-0 rounded-2xl bg-waka-600 px-5 py-3.5 text-base font-black text-white shadow-md active:bg-waka-700 sm:w-auto sm:min-w-[10rem]"
          >
            {t(lang, "stockAddProductBtn")}
          </button>
        ) : null}
      </header>

      {freeProductLimitReached ? (
        <section className="rounded-3xl border-2 border-orange-200 bg-orange-50 p-5 shadow-sm">
          <p className="text-lg font-black text-orange-950">{t(lang, "freeLimitProductsTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-orange-950/80">
            {tTemplate(lang, "freeLimitProductsBody", { count: String(productLimit ?? 10) })}
          </p>
          {lockedProductCount > 0 ? (
            <p className="mt-2 text-sm font-bold text-orange-950">
              {t(lang, "freePlanLockedProductsNotice")
                .replace("{{locked}}", String(lockedProductCount))
                .replace("{{limit}}", String(productLimit ?? 10))}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link to="/upgrade" className="rounded-2xl bg-stone-950 px-4 py-3 text-center text-sm font-black text-white">
              {t(lang, "freeLimitUpgrade")}
            </Link>
            <Link
              to="/support"
              className="rounded-2xl border-2 border-orange-300 bg-white px-4 py-3 text-center text-sm font-black text-orange-950"
            >
              {t(lang, "freeLimitSupport")}
            </Link>
          </div>
        </section>
      ) : null}

      {(canRestock || canSuppliers) && products.length > 0 ? (
        <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 shadow-sm">
          <span className="w-full text-xs font-bold text-slate-500 sm:w-auto sm:pr-1">{t(lang, "stockRestockLinks")}</span>
          {canRestock ? (
            <Link to="/restock" className="rounded-xl bg-waka-600 px-3 py-2 text-sm font-black text-white">
              {t(lang, "stockGoRestock")}
            </Link>
          ) : null}
          {canSuppliers ? (
            <Link
              to="/suppliers"
              className="rounded-xl border border-waka-200 bg-waka-50 px-3 py-2 text-sm font-black text-waka-950"
            >
              {t(lang, "stockGoSuppliers")}
            </Link>
          ) : null}
          {canPurchaseHistory && buildRestockSuggestions(lang, unlockedProducts, sales, purchases).length > 0 ? (
            <button
              type="button"
              onClick={() => setShowRestockIdeas((v) => !v)}
              className="ml-auto text-sm font-bold text-waka-800 underline-offset-2 hover:underline"
            >
              {showRestockIdeas ? t(lang, "stockHideRestockIdeas") : t(lang, "stockShowRestockIdeas")}
            </button>
          ) : null}
        </section>
      ) : null}
      {showRestockIdeas && canPurchaseHistory && products.length > 0 ? (
        <ul className="rounded-2xl border border-waka-100 bg-waka-50/50 px-4 py-3 text-sm font-semibold text-slate-700">
          {buildRestockSuggestions(lang, unlockedProducts, sales, purchases).map((s, i) => (
            <li key={i} className="py-0.5">
              · {s}
            </li>
          ))}
        </ul>
      ) : null}

      {canAdd && unlockedProducts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={openStarter}
            className="rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800"
          >
            {t(lang, "starterPackOpen")}
          </button>
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={() => setBulkOpen(true)}
            className="rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-800"
          >
            {t(lang, "bulkAddOpen")}
          </button>
        </div>
      ) : null}

      {unlockedProducts.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-waka-200 bg-gradient-to-b from-waka-50/80 to-white px-6 py-10 text-center">
          <p className="text-xl font-black text-slate-900">{t(lang, "stockEmptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-sm text-base text-slate-600">{t(lang, "stockEmptySub")}</p>
          {canAdd ? (
            <button
              type="button"
              disabled={freeProductLimitReached}
              onClick={openAddProductSheet}
              className="mt-6 w-full max-w-xs rounded-2xl bg-waka-600 px-6 py-4 text-lg font-black text-white shadow-md active:bg-waka-700 sm:mx-auto"
            >
              {t(lang, "stockAddProductBtn")}
            </button>
          ) : null}
          {canAdd ? (
            <button
              type="button"
              disabled={freeProductLimitReached}
              onClick={openStarter}
              className="mt-3 text-sm font-bold text-waka-800 underline-offset-2 hover:underline"
            >
              {t(lang, "starterPackOpen")}
            </button>
          ) : null}
        </section>
      ) : (
        <section className="space-y-4">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "stockYourProducts")}</h2>

          <StockListToolbar
            lang={lang}
            listQuery={listQuery}
            onListQuery={setListQuery}
            listSort={listSort}
            onListSort={setListSort}
            listFilter={listFilter}
            onListFilter={setListFilter}
            stockCategoryFilter={stockCategoryFilter}
            onStockCategoryFilter={setStockCategoryFilter}
            stockCategoryPicklist={stockCategoryPicklist}
            stockHasUncategorized={stockHasUncategorized}
            groupByCategory={groupByCategory}
            onGroupByCategory={(v) => setStockGroupByCategoryOverride(v)}
          />

          {listableProducts.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-base font-semibold text-slate-500">
              {t(lang, "stockNoListMatch")}
            </p>
          ) : groupByCategory && categoryGroups ? (
            <div className="space-y-5">
              {categoryGroups.keys.map((gk) => (
                <div key={gk}>
                  <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-waka-800">
                    {gk === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : gk}
                  </h3>
                  <ul className="space-y-3">
                    {(categoryGroups.map.get(gk) ?? []).map((p) => (
                      <StockProductCard
                        key={p.id}
                        lang={lang}
                        product={p}
                        locked={isProductPlanLocked(p.id, lockedIds)}
                        canAdd={canAdd}
                        canAdjust={canAdjust}
                        canRemove={canRemove}
                        canSell={canSell}
                        onAction={(action) => handleRowAction(p, action)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-3">
              {listableProducts.map((p) => (
                <StockProductCard
                  key={p.id}
                  lang={lang}
                  product={p}
                  locked={isProductPlanLocked(p.id, lockedIds)}
                  canAdd={canAdd}
                  canAdjust={canAdjust}
                  canRemove={canRemove}
                  canSell={canSell}
                  onAction={(action) => handleRowAction(p, action)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {quickOpen ? (
        <AppModalOverlay
          className="z-[70] flex flex-col justify-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
          role="dialog"
          aria-modal
          onClick={() => setQuickOpen(false)}
        >
          <form
            onSubmit={submitQuick}
            className="flex max-h-[min(92dvh,900px)] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-2">
            <p className="text-center text-xl font-black text-slate-900">{t(lang, "stockQuickAddTitle")}</p>
            <p className="mt-1 text-center text-sm text-slate-500">{t(lang, "stockQuickAddSub")}</p>
            {guessPreview ? (
              <p className="mt-3 rounded-2xl bg-waka-50 px-3 py-2 text-sm font-semibold text-waka-900">
                {t(lang, "smartGuessHint")}: {t(lang, `mode_${guessPreview.sellingMode}`)} · {guessPreview.baseUnit}
              </p>
            ) : null}
            <div className="mt-4">
              <QuickAddProductFields
                lang={lang}
                variant="sheet"
                categorySuggestions={stockCategoryPicklist}
                values={{
                  name: qaName,
                  category: qaCategory,
                  sellUnitPreset: qaUnitPreset,
                  sellUnitCustom: qaUnitCustom,
                  price: qaPrice,
                  stock: qaStock,
                  buyPackTotal: qaBuyPackTotal,
                }}
                onChange={(patch) => {
                  if (patch.name !== undefined) setQaName(patch.name);
                  if (patch.category !== undefined) setQaCategory(patch.category);
                  if (patch.sellUnitPreset !== undefined) setQaUnitPreset(patch.sellUnitPreset);
                  if (patch.sellUnitCustom !== undefined) setQaUnitCustom(patch.sellUnitCustom);
                  if (patch.price !== undefined) setQaPrice(patch.price);
                  if (patch.stock !== undefined) setQaStock(patch.stock);
                  if (patch.buyPackTotal !== undefined) setQaBuyPackTotal(patch.buyPackTotal);
                }}
              />
            </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-white px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="min-h-[52px] rounded-2xl border-2 py-3 text-lg font-bold" onClick={() => setQuickOpen(false)}>
                {t(lang, "cancel")}
              </button>
              <button type="submit" className="min-h-[52px] rounded-2xl bg-waka-600 py-3 text-lg font-black text-white">
                {t(lang, "quickAddSave")}
              </button>
            </div>
            </div>
          </form>
        </AppModalOverlay>
      ) : null}

      {starterOpen ? (
        <AppModalOverlay
          className="z-[56] flex items-end justify-center bg-black/50 sm:items-center"
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
                      className="h-6 w-6 accent-waka-600"
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
              <button type="button" className="rounded-2xl bg-waka-600 py-4 text-lg font-black text-white" onClick={applyStarter}>
                {t(lang, "starterPackApply")}
              </button>
            </div>
          </div>
        </AppModalOverlay>
      ) : null}

      <SimpleAddProductWizard
        lang={lang}
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        shelves={stockCategoryPicklist}
        generalCategoryLabel={t(lang, "generalCategory")}
        disabled={freeProductLimitReached}
        onSave={saveFromSimpleWizard}
      />

      <StockProductEditModal
        lang={lang}
        product={editProduct}
        open={editProduct !== null}
        onClose={() => setEditProduct(null)}
        businessUnitOptions={businessUnitOptions}
        canPresets={canPresets}
        canPurchaseHistory={canPurchaseHistory}
        purchaseLines={editProduct ? (purchaseLinesByProduct.get(editProduct.id) ?? []) : []}
        movements={editProduct ? (movementsByProduct.get(editProduct.id) ?? []) : []}
        updateProduct={updateProduct}
        categorySuggestions={stockCategoryPicklist}
      />

      <ProductLockedModal lang={lang} open={productLockedOpen} onClose={() => setProductLockedOpen(false)} />

      {removeId ? (
        <AppModalOverlay className="z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
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
        </AppModalOverlay>
      ) : null}
    </div>
  );
}
