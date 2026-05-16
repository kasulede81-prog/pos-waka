import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { buildRestockSuggestions } from "../lib/restockSuggestions";
import type { Language, Product, SellingMode } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { formatProductPriceLabel } from "../store/usePosStore";
import { formatStockLabel, isLowStock } from "../lib/sellingEngine";
import { inferFromProductName } from "../lib/smartProductGuess";
import { starterPackForBusinessType, type StarterLine } from "../data/starterPacks";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { maxProductsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { StockProductEditModal } from "../components/StockProductEditModal";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  normalizedCategoryKey,
  productMatchesCategoryFilter,
} from "../lib/productCategories";

function sellingModeFromSellUnit(unit: string): SellingMode {
  const s = unit.toLowerCase();
  if (/\b(kg|kilo|gram|gramme|litre|liter)\b/.test(s) || /^g$|^l$/.test(s)) return "weighted";
  return "unit";
}

const UNIT_PRESETS: Record<string, string[]> = {
  kiosk_duka: ["piece", "packet", "bottle", "crate"],
  restaurant: ["plate", "cup", "litre", "tray"],
  hardware: ["meter", "roll", "box"],
  pharmacy: ["tablet", "strip", "bottle"],
  boutique: ["pair", "pack", "piece"],
  default: ["piece", "kg", "gram", "litre", "bottle", "packet", "box", "tray", "crate", "sack", "bale", "roll", "pair", "meter", "carton", "bundle", "dozen", "tin", "plate", "cup"],
};

const BULK_QUICK_UNITS = ["piece", "packet", "bottle", "crate", "kg"] as const;
const BULK_UNIT_CUSTOM = "custom";

type BulkRow = { name: string; price: string; stock: string; unitPreset: string; unitCustom: string };

function emptyBulkRows(
  n: number,
  defaults?: { unitPreset?: string; unitCustom?: string },
): BulkRow[] {
  const unitPreset = defaults?.unitPreset ?? "piece";
  const unitCustom = defaults?.unitCustom ?? "";
  return Array.from({ length: n }, () => ({
    name: "",
    price: "",
    stock: "",
    unitPreset,
    unitCustom,
  }));
}

type StarterRowState = StarterLine & { enabled: boolean; priceStr: string; stockStr: string };

export function StockPage({ lang }: { lang: Language }) {
  const stockQuickCategoryListId = useId();
  const stockModalCategoryListId = useId();
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
  const bulkQuickAddProducts = usePosStore((s) => s.bulkQuickAddProducts);
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

  const [mainName, setMainName] = useState("");
  const [mainCategory, setMainCategory] = useState("");
  const [mainSellUnitPreset, setMainSellUnitPreset] = useState("piece");
  const [mainSellUnitCustom, setMainSellUnitCustom] = useState("");
  const [mainPrice, setMainPrice] = useState("");
  const [mainStock, setMainStock] = useState("");
  const [boughtAs, setBoughtAs] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [piecesInside, setPiecesInside] = useState("");
  const [supplierName, setSupplierName] = useState("");

  const [starterRows, setStarterRows] = useState<StarterRowState[]>([]);

  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => emptyBulkRows(10));

  const navigate = useNavigate();
  const [listQuery, setListQuery] = useState("");
  const [listSort, setListSort] = useState<"name_az" | "name_za" | "stock_low" | "updated">("name_az");
  const [listFilter, setListFilter] = useState<"all" | "low">("all");
  const [actionTick, setActionTick] = useState(0);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [addProductFormOpen, setAddProductFormOpen] = useState(() => products.length === 0);
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [stockGroupByCategoryOverride, setStockGroupByCategoryOverride] = useState<boolean | null>(null);

  const guessPreview = useMemo(() => {
    const n = qaName.trim();
    if (!n) return null;
    return inferFromProductName(n);
  }, [qaName]);

  const resolveSellUnit = (preset: string, custom: string) =>
    (preset === "custom" ? custom : preset).trim() || "piece";

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

  useEffect(() => {
    if (products.length > 0) setAddProductFormOpen(false);
  }, [products.length]);

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
    const sellUnit = resolveSellUnit(qaUnitPreset, qaUnitCustom);
    const r = quickAddProduct({
      name: qaName,
      priceUgx: price,
      stockQty: Number(qaStock) || 0,
      category: qaCategory.trim() || t(lang, "generalCategory"),
      baseUnit: sellUnit,
      sellingMode: sellingModeFromSellUnit(sellUnit),
    });
    if (!r.ok) return;
    setQaName("");
    setQaUnitPreset("piece");
    setQaUnitCustom("");
    setQaPrice("");
    setQaStock("");
    setQaCategory("");
    setQuickOpen(false);
  };

  const submitMainQuick = (e: FormEvent) => {
    e.preventDefault();
    if (freeProductLimitReached) return;
    const price = Math.floor(Number(mainPrice.replace(/\D/g, "")) || 0);
    if (price <= 0) return;
    const sellUnit = resolveSellUnit(mainSellUnitPreset, mainSellUnitCustom);
    const sellingMode = sellingModeFromSellUnit(sellUnit);
    const pack = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
    const pieces = Math.floor(Number(piecesInside.replace(/[^\d.]/g, "")) || 0);
    const hasTrack = boughtAs.trim().length > 0 && pack > 0 && pieces > 0;
    const costPerSell = hasTrack ? Math.floor(pack / pieces) : undefined;
    const buyingUnitLabel = hasTrack
      ? supplierName.trim()
        ? `${boughtAs.trim()} · ${supplierName.trim()}`
        : boughtAs.trim()
      : undefined;

    const r = quickAddProduct({
      name: mainName.trim(),
      priceUgx: price,
      stockQty: Number(mainStock.replace(/[^\d.]/g, "")) || 0,
      category: mainCategory.trim() || t(lang, "generalCategory"),
      baseUnit: sellUnit,
      sellingMode,
      buyingUnit: hasTrack ? buyingUnitLabel! : undefined,
      conversionRate: hasTrack ? pieces : undefined,
      costPricePerUnitUgx: hasTrack ? costPerSell! : undefined,
    });
    if (!r.ok) return;
    setMainName("");
    setMainCategory("");
    setMainSellUnitPreset("piece");
    setMainSellUnitCustom("");
    setMainPrice("");
    setMainStock("");
    setBoughtAs("");
    setBuyPackPrice("");
    setPiecesInside("");
    setSupplierName("");
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

  const submitBulk = () => {
    const cat = t(lang, "generalCategory");
    const rows = bulkRows
      .map((r) => {
        const rawUnit = (r.unitPreset === BULK_UNIT_CUSTOM ? r.unitCustom : r.unitPreset).trim() || "piece";
        const baseUnit = rawUnit.toLowerCase();
        const sellingMode = sellingModeFromSellUnit(baseUnit);
        return {
          name: r.name.trim(),
          priceUgx: Math.floor(Number(r.price) || 0),
          stockQty: Number(r.stock) || 0,
          category: cat,
          baseUnit,
          sellingMode,
        };
      })
      .filter((r) => r.name.length > 0 && r.priceUgx > 0);
    bulkQuickAddProducts(productSlotsLeft === null ? rows : rows.slice(0, productSlotsLeft));
    setBulkRows(emptyBulkRows(10));
    setBulkOpen(false);
  };

  const openDuplicateToQuick = (p: Product) => {
    if (freeProductLimitReached) return;
    setAddProductFormOpen(true);
    setMainName(`${p.name} (2)`);
    setMainCategory((p.category ?? "").trim());
    setMainSellUnitPreset(businessUnitOptions.includes(p.baseUnit) ? p.baseUnit : "custom");
    setMainSellUnitCustom(businessUnitOptions.includes(p.baseUnit) ? "" : p.baseUnit);
    setMainPrice(String(Math.floor(p.sellingPricePerUnitUgx)));
    setMainStock(String(p.stockOnHand));
    setBoughtAs(p.buyingUnit?.replace(/\s·\s.*$/, "") ?? "");
    setSupplierName(p.buyingUnit && p.buyingUnit.includes(" · ") ? p.buyingUnit.split(" · ").slice(1).join(" · ") : "");
    setBuyPackPrice(
      p.conversionRate && p.conversionRate > 0
        ? String(Math.floor(p.costPricePerUnitUgx * p.conversionRate))
        : "",
    );
    setPiecesInside(p.conversionRate && p.conversionRate > 0 ? String(p.conversionRate) : "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmRemove = (id: string) => {
    if (!canRemove) return;
    removeProduct(id);
    setRemoveId(null);
  };

  const handleRowAction = (p: Product, action: string) => {
    setActionTick((x) => x + 1);
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
        if (canSell) navigate("/pos");
        break;
      default:
        break;
    }
  };

  const renderStockRow = (p: Product) => (
    <li key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-black text-slate-900">{p.name}</p>
        <p className="truncate text-xs text-slate-500">
          {normalizedCategoryKey(p) ? p.category.trim() : t(lang, "uncategorized")} · {t(lang, `mode_${p.sellingMode}`)} ·{" "}
          {formatProductPriceLabel(p)}
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        <p className="text-right text-sm font-black text-slate-800">{formatStockLabel(p)}</p>
        <select
          key={`${p.id}-${actionTick}`}
          defaultValue=""
          aria-label={t(lang, "stockRowActionLabel")}
          onChange={(e) => {
            const v = e.target.value;
            if (v) handleRowAction(p, v);
          }}
          className="min-h-[44px] min-w-[10.5rem] rounded-xl border-2 border-slate-200 bg-white px-2 py-2 text-xs font-black text-slate-900 sm:min-w-[11rem] sm:text-sm"
        >
          <option value="">{t(lang, "stockRowActionPlaceholder")}</option>
          {canAdd ? <option value="edit">{t(lang, "stockActionEditDetails")}</option> : null}
          {canAdjust ? <option value="add10">{t(lang, "stockActionAdd10")}</option> : null}
          {canAdjust ? <option value="add1">{t(lang, "stockActionAdd1")}</option> : null}
          {canAdjust ? <option value="sold1">{t(lang, "stockActionSold1")}</option> : null}
          {canAdjust ? <option value="damaged1">{t(lang, "stockActionDamaged1")}</option> : null}
          {canAdjust ? <option value="home1">{t(lang, "stockActionHome1")}</option> : null}
          {canAdd ? <option value="duplicate">{t(lang, "stockActionDuplicate")}</option> : null}
          {canRemove ? <option value="remove">{t(lang, "stockActionRemove")}</option> : null}
          {canSell ? <option value="sell">{t(lang, "stockActionOpenSell")}</option> : null}
        </select>
      </div>
    </li>
  );

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-3xl font-black text-slate-900">{t(lang, "stockTitle")}</h1>
        <p className="mt-1 text-lg text-slate-600">{t(lang, "stockChangeTitle")}</p>
      </div>

      {freeProductLimitReached ? (
        <section className="rounded-3xl border-2 border-orange-200 bg-orange-50 p-5 shadow-sm">
          <p className="text-lg font-black text-orange-950">{t(lang, "freeLimitProductsTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-orange-950/80">
            {tTemplate(lang, "freeLimitProductsBody", { count: String(productLimit ?? 10) })}
          </p>
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
        <section className="rounded-3xl border-2 border-waka-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-wide text-waka-900">{t(lang, "stockRestockLinks")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canRestock ? (
              <Link
                to="/restock"
                className="rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white shadow-sm"
              >
                {t(lang, "stockGoRestock")}
              </Link>
            ) : null}
            {canSuppliers ? (
              <Link
                to="/suppliers"
                className="rounded-2xl border-2 border-waka-200 bg-waka-50/80 px-4 py-3 text-sm font-black text-waka-950"
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

      {canAdd ? (
        <details
          className="rounded-[2rem] border-2 border-waka-300 bg-gradient-to-b from-white to-waka-50/60 shadow-lg open:shadow-md"
          open={addProductFormOpen}
          onToggle={(e) => setAddProductFormOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer list-none px-5 py-4 marker:hidden sm:px-6 sm:py-5 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-2 text-lg font-black text-waka-900">
              {t(lang, "stockAddProductToggle")}
              <span className="text-xs font-bold uppercase tracking-wide text-waka-700">{t(lang, "stockQuickAddHeading")}</span>
            </span>
          </summary>
          <form
            onSubmit={submitMainQuick}
            className="space-y-4 border-t border-waka-100/80 px-5 pb-5 pt-4 sm:px-6 sm:pb-6"
          >
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-waka-800">{t(lang, "stockQuickAddHeading")}</p>
              <p className="mt-1 text-lg font-black text-slate-900">{t(lang, "stockQuickAddTitle")}</p>
              <p className="mt-1 text-base text-slate-600">{t(lang, "stockQuickAddSub")}</p>
            </div>

            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "quickAddName")}</span>
              <input
                value={mainName}
                onChange={(e) => setMainName(e.target.value)}
                placeholder={t(lang, "productNamePh")}
                required
                className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-semibold outline-none ring-waka-200 focus:ring"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "posCategoryLabel")}</span>
              <input
                value={mainCategory}
                onChange={(e) => setMainCategory(e.target.value)}
                list={stockCategoryPicklist.length > 0 ? stockQuickCategoryListId : undefined}
                placeholder={t(lang, "categoryNewPlaceholder")}
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-semibold outline-none ring-waka-200 focus:ring"
              />
              {stockCategoryPicklist.length > 0 ? (
                <datalist id={stockQuickCategoryListId}>
                  {stockCategoryPicklist.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              ) : null}
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-800">{t(lang, "howYouSellUnit")}</span>
              <p className="mt-0.5 text-xs text-slate-500">{t(lang, "stockSellUnitSelectHint")}</p>
              <select
                value={mainSellUnitPreset === "custom" ? "custom" : mainSellUnitPreset}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") setMainSellUnitPreset("custom");
                  else {
                    setMainSellUnitPreset(v);
                    setMainSellUnitCustom("");
                  }
                }}
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-900 outline-none ring-waka-200 focus:ring"
              >
                {businessUnitOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
                <option value="custom">{t(lang, "unitCustomOption")}</option>
              </select>
            </label>
            {mainSellUnitPreset === "custom" ? (
              <label className="block">
                <span className="text-sm font-bold text-slate-800">{t(lang, "unitCustomPlaceholder")}</span>
                <input
                  value={mainSellUnitCustom}
                  onChange={(e) => setMainSellUnitCustom(e.target.value)}
                  placeholder={t(lang, "unitCustomPlaceholder")}
                  className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
                />
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold text-slate-800">{t(lang, "quickAddPrice")}</span>
                <input
                  value={mainPrice}
                  onChange={(e) => setMainPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  inputMode="numeric"
                  placeholder="0"
                  required
                  className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-2xl font-black outline-none ring-waka-200 focus:ring"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-800">{t(lang, "stockNowLabel")}</span>
                <input
                  value={mainStock}
                  onChange={(e) => setMainStock(e.target.value.replace(/[^\d.]/g, "").slice(0, 12))}
                  inputMode="decimal"
                  placeholder="0"
                  required
                  className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-2xl font-black outline-none ring-waka-200 focus:ring"
                />
              </label>
            </div>

            <details className="group rounded-2xl border-2 border-slate-200 bg-white/90 px-4 open:pb-3 open:pt-1">
              <summary className="cursor-pointer list-none py-4 text-base font-black text-slate-900 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-2">
                  {t(lang, "trackBuyingProfit")}
                  <span className="text-xs font-bold text-waka-700">{t(lang, "optional")}</span>
                </span>
              </summary>
              <p className="text-xs text-slate-500">{t(lang, "trackBuyingProfitHint")}</p>
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-bold text-slate-800">
                  {t(lang, "howYouBuyPack")}
                  <input
                    value={boughtAs}
                    onChange={(e) => setBoughtAs(e.target.value)}
                    placeholder={t(lang, "howYouBuyPackPh")}
                    className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-slate-800">
                    {t(lang, "buyingPackPriceLabel")}
                    <input
                      value={buyPackPrice}
                      onChange={(e) => setBuyPackPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                      inputMode="numeric"
                      placeholder="0"
                      className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-bold"
                    />
                  </label>
                  <label className="block text-sm font-bold text-slate-800">
                    {t(lang, "howManyInsideLabel")}
                    <input
                      value={piecesInside}
                      onChange={(e) => setPiecesInside(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                      inputMode="decimal"
                      placeholder="20"
                      className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-bold"
                    />
                  </label>
                </div>
                <label className="block text-sm font-bold text-slate-800">
                  {t(lang, "supplierOptionalLabel")}
                  <input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder={t(lang, "supplierOptionalPh")}
                    className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
                  />
                </label>
              </div>
            </details>

            <button
              type="submit"
              disabled={freeProductLimitReached}
              className="w-full min-h-[56px] rounded-3xl bg-waka-600 py-4 text-xl font-black text-white shadow-md active:scale-[0.99] active:bg-waka-700"
            >
              {t(lang, "saveProduct")}
            </button>
          </form>
        </details>
      ) : null}

      {products.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-waka-200 bg-gradient-to-b from-waka-50 to-white p-6 text-center shadow-sm">
          <p className="text-2xl font-black text-slate-900">{t(lang, "stockEmptyTitle")}</p>
          <p className="mt-2 text-lg text-slate-600">{t(lang, "stockEmptySub")}</p>
          <p className="mt-2 text-base font-semibold text-waka-900">{t(lang, "stockEmptyUseFormAbove")}</p>
          {canAdd ? (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                disabled={freeProductLimitReached}
                onClick={() => setQuickOpen(true)}
                className="rounded-3xl border-2 border-waka-300 bg-white px-6 py-4 text-lg font-black text-waka-900"
              >
                {t(lang, "quickAddOpen")}
              </button>
              <button
                type="button"
                disabled={freeProductLimitReached}
                onClick={openStarter}
                className="rounded-3xl bg-waka-600 px-6 py-4 text-lg font-black text-white shadow-lg active:scale-[0.99]"
              >
                {t(lang, "starterPackOpen")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canAdd ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={() => setQuickOpen(true)}
            className="min-h-[64px] rounded-3xl border-2 border-waka-200 bg-white py-4 text-base font-black text-waka-900 shadow-sm active:bg-waka-50"
          >
            {t(lang, "quickAddOpen")}
          </button>
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={openStarter}
            className="min-h-[64px] rounded-3xl border-2 border-slate-200 bg-white py-4 text-base font-black text-slate-900 active:bg-slate-50"
          >
            {t(lang, "starterPackOpen")}
          </button>
          <button
            type="button"
            disabled={freeProductLimitReached}
            onClick={() => setBulkOpen(true)}
            className="min-h-[64px] rounded-3xl border-2 border-violet-200 bg-violet-50 py-4 text-base font-black text-violet-950"
          >
            {t(lang, "bulkAddOpen")}
          </button>
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-2xl font-black text-slate-900">{t(lang, "quickStockFix")}</h2>
          {products.length > 0 ? (
            <p className="text-sm font-semibold text-slate-500">
              {tTemplate(lang, "stockListCount", { shown: String(listableProducts.length), total: String(products.length) })}
            </p>
          ) : null}
        </div>

        {products.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-lg text-slate-600">{t(lang, "stockListEmptyHint")}</p>
        ) : (
          <div className="space-y-3 rounded-2xl border-2 border-slate-100 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="block min-w-0 flex-1 sm:min-w-[12rem]">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">{t(lang, "stockListSearchPh")}</span>
                <input
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  placeholder={t(lang, "stockListSearchPh")}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-semibold text-slate-900 outline-none ring-waka-200 focus:ring"
                />
              </label>
              <label className="block sm:w-44">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">{t(lang, "stockListSortLabel")}</span>
                <select
                  value={listSort}
                  onChange={(e) => setListSort(e.target.value as "name_az" | "name_za" | "stock_low" | "updated")}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value="name_az">{t(lang, "stockSortNameAz")}</option>
                  <option value="name_za">{t(lang, "stockSortNameZa")}</option>
                  <option value="stock_low">{t(lang, "stockSortStockLow")}</option>
                  <option value="updated">{t(lang, "stockSortUpdatedNew")}</option>
                </select>
              </label>
              <label className="block sm:w-44">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">{t(lang, "stockFilterLabel")}</span>
                <select
                  value={listFilter}
                  onChange={(e) => setListFilter(e.target.value as "all" | "low")}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value="all">{t(lang, "stockFilterAll")}</option>
                  <option value="low">{t(lang, "stockFilterLow")}</option>
                </select>
              </label>
              <label className="block sm:w-48">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">{t(lang, "stockFilterCategoryLabel")}</span>
                <select
                  value={stockCategoryFilter}
                  onChange={(e) => setStockCategoryFilter(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                >
                  <option value={CATEGORY_FILTER_ALL}>{t(lang, "posCategoryAll")}</option>
                  {stockHasUncategorized ? (
                    <option value={UNCATEGORIZED_SENTINEL}>{t(lang, "uncategorized")}</option>
                  ) : null}
                  {stockCategoryPicklist.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 self-center pt-1 sm:pt-6">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-waka-600"
                  checked={groupByCategory}
                  onChange={(e) => setStockGroupByCategoryOverride(e.target.checked)}
                />
                <span className="text-sm font-bold text-slate-800">{t(lang, "stockGroupByCategory")}</span>
              </label>
            </div>

            {listableProducts.length === 0 ? (
              <p className="py-8 text-center text-base font-semibold text-slate-500">{t(lang, "stockNoListMatch")}</p>
            ) : groupByCategory && categoryGroups ? (
              <div className="divide-y divide-slate-100">
                {categoryGroups.keys.map((gk) => (
                  <div key={gk} className="py-3 first:pt-1">
                    <h3 className="px-1 pb-2 text-xs font-black uppercase tracking-wide text-waka-800">
                      {gk === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : gk}
                    </h3>
                    <ul className="divide-y divide-slate-100">{(categoryGroups.map.get(gk) ?? []).map((p) => renderStockRow(p))}</ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">{listableProducts.map((p) => renderStockRow(p))}</ul>
            )}
          </div>
        )}
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
            <label className="mt-4 block text-base font-bold text-slate-800">
              {t(lang, "posCategoryLabel")}
              <input
                value={qaCategory}
                onChange={(e) => setQaCategory(e.target.value)}
                list={stockCategoryPicklist.length > 0 ? stockModalCategoryListId : undefined}
                placeholder={t(lang, "categoryNewPlaceholder")}
                className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg font-semibold"
              />
              {stockCategoryPicklist.length > 0 ? (
                <datalist id={stockModalCategoryListId}>
                  {stockCategoryPicklist.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              ) : null}
            </label>
            <label className="mt-4 block text-base font-bold text-slate-800">
              {t(lang, "howYouSellUnit")}
              <p className="mt-0.5 text-xs font-normal text-slate-500">{t(lang, "stockSellUnitSelectHint")}</p>
              <select
                value={qaUnitPreset === "custom" ? "custom" : qaUnitPreset}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") setQaUnitPreset("custom");
                  else {
                    setQaUnitPreset(v);
                    setQaUnitCustom("");
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
            {qaUnitPreset === "custom" ? (
              <input
                value={qaUnitCustom}
                onChange={(e) => setQaUnitCustom(e.target.value)}
                placeholder={t(lang, "unitCustomPlaceholder")}
                className="mt-2 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            ) : null}
            {guessPreview ? (
              <p className="mt-2 rounded-2xl bg-waka-50 px-3 py-2 text-sm font-semibold text-waka-900">
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
              <button type="submit" className="rounded-2xl bg-waka-600 py-4 text-lg font-black text-white">
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
            <p className="mt-3 text-center text-sm font-bold leading-snug text-slate-800">{t(lang, "bulkAddSellHowHint")}</p>
            <div className="mt-4 space-y-3">
              <div className="hidden text-xs font-bold uppercase text-slate-500 sm:grid sm:grid-cols-12 sm:gap-2">
                <span className="col-span-4">{t(lang, "quickAddName")}</span>
                <span className="col-span-4">{t(lang, "bulkAddUnitCol")}</span>
                <span className="col-span-2 text-right">{t(lang, "quickAddPrice")}</span>
                <span className="col-span-2 text-right">{t(lang, "quickAddStock")}</span>
              </div>
              {bulkRows.map((row, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/40 p-3 sm:grid sm:grid-cols-12 sm:items-start sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0"
                >
                  <input
                    value={row.name}
                    onChange={(e) =>
                      setBulkRows((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                    }
                    className="w-full rounded-xl border-2 px-2 py-3 text-base sm:col-span-4"
                    placeholder="…"
                  />
                  <div className="sm:col-span-4">
                    <p className="mb-1.5 text-[11px] font-bold uppercase text-slate-500 sm:hidden">{t(lang, "bulkAddUnitCol")}</p>
                    <select
                      value={row.unitPreset}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBulkRows((rows) =>
                          rows.map((r, j) =>
                            j === i ? { ...r, unitPreset: v, unitCustom: v === BULK_UNIT_CUSTOM ? r.unitCustom : "" } : r,
                          ),
                        );
                      }}
                      className="w-full rounded-xl border-2 border-slate-200 bg-white px-2 py-2.5 text-sm font-black text-slate-900"
                    >
                      {BULK_QUICK_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                      <option value={BULK_UNIT_CUSTOM}>{t(lang, "bulkAddUnitCustom")}</option>
                    </select>
                    {row.unitPreset === BULK_UNIT_CUSTOM ? (
                      <input
                        value={row.unitCustom}
                        onChange={(e) =>
                          setBulkRows((rows) =>
                            rows.map((r, j) =>
                              j === i ? { ...r, unitCustom: e.target.value.replace(/[^a-zA-Z0-9\s./\-]/g, "").slice(0, 24) } : r,
                            ),
                          )
                        }
                        className="mt-2 w-full rounded-xl border-2 border-dashed border-orange-200 px-2 py-2 text-sm font-semibold text-slate-900 placeholder:text-slate-400"
                        placeholder={t(lang, "bulkAddUnitCustomPlaceholder")}
                      />
                    ) : null}
                  </div>
                  <input
                    value={row.price}
                    onChange={(e) =>
                      setBulkRows((rows) => rows.map((r, j) => (j === i ? { ...r, price: e.target.value.replace(/\D/g, "") } : r)))
                    }
                    inputMode="numeric"
                    className="w-full rounded-xl border-2 px-2 py-3 text-base font-bold sm:col-span-2"
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
                    className="w-full rounded-xl border-2 px-2 py-3 text-base font-bold sm:col-span-2"
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-2xl border-2 py-3 text-sm font-bold text-slate-700"
              onClick={() =>
                setBulkRows((r) => {
                  const last = r[r.length - 1];
                  const nextDefaults =
                    last && last.unitPreset === BULK_UNIT_CUSTOM
                      ? { unitPreset: BULK_UNIT_CUSTOM, unitCustom: last.unitCustom }
                      : { unitPreset: last?.unitPreset ?? "piece", unitCustom: "" };
                  return [...r, ...emptyBulkRows(5, nextDefaults)];
                })
              }
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
