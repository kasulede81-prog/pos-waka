import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Language, Product } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isLowStock } from "../lib/sellingEngine";
import { inferProductGuess, uiPlaceholder } from "../lib/pharmacyUx";
import { starterPackForBusinessType, starterExpiryDateIso, type StarterLine } from "../data/starterPacks";
import { PharmacyAddMedicineWizard } from "../components/stock/PharmacyAddMedicineWizard";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { maxProductsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { StockProductEditModal } from "../components/stock/StockProductEditModal";
import { ProductLockedModal } from "../components/ProductLockedModal";
import { isProductPlanLocked, lockedProductIds } from "../lib/productPlanLock";
import { SimpleAddProductWizard, type SimpleAddWizardPrefill, type SimpleAddWizardStep } from "../components/stock/SimpleAddProductWizard";
import { AiProductAssistSheet } from "../components/stock/AiProductAssistSheet";
import { BulkInventoryAiModal } from "../components/stock/BulkInventoryAiModal";
import { mapBulkRowsToQuickAdd } from "../lib/ai/bulkInventoryAi";
import { useAiFeatureGate } from "../hooks/useAiFeatureGate";
import { QuickAddProductFields } from "../components/stock/QuickAddProductFields";
import { StockListToolbar } from "../components/stock/StockListToolbar";
import { StockProductCard } from "../components/stock/StockProductCard";
import { StockSectionTabs, type StockHubTab } from "../components/stock/StockSectionTabs";
import { StockOverviewPanel } from "../components/stock/StockOverviewPanel";
import { StockMovementsPanel } from "../components/stock/StockMovementsPanel";
import { SimpleProductRestockModal } from "../components/stock/SimpleProductRestockModal";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";
import { shelfIconFor } from "../lib/productCategories";
import { PageHeader } from "../components/layout/PageHeader";
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
  productMatchesSellSearch,
} from "../lib/productCategories";
import { defaultMenuCategoriesForBusinessType, isHospitalityMode } from "../lib/hospitality";
import { defaultPharmacyCategoriesForBusinessType, isPharmacyMode } from "../lib/pharmacy";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isWholesaleMode } from "../lib/wholesale";
import { useWholesaleTerms } from "../lib/wholesaleTerms";
import { detectBarcodeCapabilities, startBarcodeSession, stopBarcodeSession } from "../services/hardware/barcodeAdapter";

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

  const products = usePosStore((s) => s.products);
  const suppliers = usePosStore((s) => s.suppliers);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const preferences = usePosStore((s) => s.preferences);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const hospitalityMode = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const wholesaleMode = isWholesaleMode(preferences.businessType);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, preferences.businessType, preferences.hospitalityModeEnabled);
  const wt = useWholesaleTerms(lang, preferences.businessType);
  const modeTerm = hospitalityMode ? ht : wholesaleMode ? wt : pt;
  const industryPlaceholderMode = pharmacyMode || wholesaleMode || hospitalityMode;
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

  const quickAddProduct = usePosStore((s) => s.quickAddProduct);
  const bulkQuickAddProducts = usePosStore((s) => s.bulkQuickAddProducts);
  const removeProduct = usePosStore((s) => s.removeProduct);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const updateProduct = usePosStore((s) => s.updateProduct);
  const recordPurchase = usePosStore((s) => s.recordPurchase);

  const productAiGate = useAiFeatureGate("product_assistant");
  const inventoryAiGate = useAiFeatureGate("inventory_assistant");
  const aiProductAssistantEnabled = canAdd && productAiGate.enabled;
  const aiInventoryAssistantEnabled = canAdd && inventoryAiGate.enabled;

  const [quickOpen, setQuickOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [aiAssistOpen, setAiAssistOpen] = useState(false);
  const [bulkAiOpen, setBulkAiOpen] = useState(false);
  const [wizardPrefill, setWizardPrefill] = useState<SimpleAddWizardPrefill | undefined>();
  const [wizardInitialStep, setWizardInitialStep] = useState<SimpleAddWizardStep | undefined>();

  const [qaName, setQaName] = useState("");
  const [qaUnitPreset, setQaUnitPreset] = useState("piece");
  const [qaUnitCustom, setQaUnitCustom] = useState("");
  const [qaPrice, setQaPrice] = useState("");
  const [qaStock, setQaStock] = useState("");
  const [qaCategory, setQaCategory] = useState("");
  const [qaBuyPackTotal, setQaBuyPackTotal] = useState("");

  const [starterRows, setStarterRows] = useState<StarterRowState[]>([]);
  const [stockTab, setStockTab] = useState<StockHubTab>("overview");
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);

  const navigate = useNavigate();
  const [listQuery, setListQuery] = useState("");
  const [listSort, setListSort] = useState<"name_az" | "name_za" | "stock_low" | "updated">("name_az");
  const [listFilter, setListFilter] = useState<"all" | "low">("all");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [stockGroupByCategoryOverride, setStockGroupByCategoryOverride] = useState<boolean | null>(null);

  useEffect(() => {
    const caps = detectBarcodeCapabilities();
    if (!caps.hidWedge) return;
    void startBarcodeSession("hid", {
      onScan: (code) => {
        setStockTab("products");
        setListQuery(code);
      },
    });
    return () => {
      void stopBarcodeSession();
    };
  }, []);

  const guessPreview = useMemo(() => {
    const n = qaName.trim();
    if (!n) return null;
    return inferProductGuess(n, preferences.businessType, preferences.pharmacyModeEnabled);
  }, [qaName, preferences.businessType, preferences.pharmacyModeEnabled]);

  const defaultGroupByCategory = products.length > 12;
  const groupByCategory = stockGroupByCategoryOverride ?? defaultGroupByCategory;

  const stockCategoryPicklist = useMemo(() => {
    const fromProducts = distinctTrimmedCategories(products);
    if (isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
      const presets = defaultMenuCategoriesForBusinessType(preferences.businessType);
      return [...new Set([...fromProducts, ...presets])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    if (pharmacyMode) {
      const presets = defaultPharmacyCategoriesForBusinessType(preferences.businessType);
      return [...new Set([...fromProducts, ...presets])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    return fromProducts;
  }, [products, preferences.businessType, preferences.hospitalityModeEnabled, pharmacyMode]);
  const stockHasUncategorized = useMemo(() => products.some((p) => !normalizedCategoryKey(p)), [products]);

  const listableProducts = useMemo(() => {
    let list = [...products];
    const q = listQuery.trim();
    if (q) {
      list = list.filter((p) => productMatchesSellSearch(p, q));
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
  const outOfStockCount = useMemo(() => unlockedProducts.filter((p) => p.stockOnHand <= 0).length, [unlockedProducts]);
  const inventoryValueUgx = useMemo(
    () => unlockedProducts.reduce((a, p) => a + Math.max(0, p.stockOnHand) * Math.max(0, p.costPricePerUnitUgx), 0),
    [unlockedProducts],
  );
  const lowStockProducts = useMemo(() => unlockedProducts.filter((p) => isLowStock(p)), [unlockedProducts]);

  const shelfFolders = useMemo(() => {
    const keys = [...stockCategoryPicklist];
    if (stockHasUncategorized) keys.push(UNCATEGORIZED_SENTINEL);
    return keys.sort((a, b) => {
      if (a === UNCATEGORIZED_SENTINEL) return 1;
      if (b === UNCATEGORIZED_SENTINEL) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  }, [stockCategoryPicklist, stockHasUncategorized]);

  const shelfProductCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of unlockedProducts) {
      const g = normalizedCategoryKey(p) || UNCATEGORIZED_SENTINEL;
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  }, [unlockedProducts]);

  const productsInSelectedShelf = useMemo(() => {
    if (!selectedShelf) return [];
    return unlockedProducts
      .filter((p) => (normalizedCategoryKey(p) || UNCATEGORIZED_SENTINEL) === selectedShelf)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [selectedShelf, unlockedProducts]);

  const recentMovements = useMemo(
    () => [...stockMovements].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [stockMovements],
  );

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
      costPricePerUnitUgx: costPerSell ?? null,
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

  const closeAddProductWizard = () => {
    setBulkOpen(false);
    setWizardPrefill(undefined);
    setWizardInitialStep(undefined);
  };

  const openAddProductSheet = () => {
    if (freeProductLimitReached) return;
    setWizardPrefill(undefined);
    setWizardInitialStep(undefined);
    setBulkOpen(true);
  };

  const openAiProductAssist = () => {
    if (freeProductLimitReached || !aiProductAssistantEnabled) return;
    setAiAssistOpen(true);
  };

  const openBulkInventoryAi = () => {
    if (freeProductLimitReached || !aiInventoryAssistantEnabled) return;
    setBulkAiOpen(true);
  };

  const handleBulkAiImport = (rows: ReturnType<typeof mapBulkRowsToQuickAdd>) => bulkQuickAddProducts(rows);

  const handleAiContinue = (prefill: SimpleAddWizardPrefill) => {
    setAiAssistOpen(false);
    setWizardPrefill(prefill);
    setWizardInitialStep("stock");
    setBulkOpen(true);
  };

  const handleAiContinueManual = (name: string) => {
    setAiAssistOpen(false);
    setWizardPrefill({
      name,
      shelf: "",
      sellUnit: "piece",
      sellUnitCustom: "",
      hasPack: false,
      packKind: "crate",
      packCustom: "",
      piecesPerPack: "",
    });
    setWizardInitialStep("name");
    setBulkOpen(true);
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
        category: row.category ?? cat,
        inferName: row.inferName,
        sellingMode: row.sellingMode,
        baseUnit: row.baseUnit,
        medicineStrength: row.medicineStrength ?? null,
        medicineForm: row.medicineForm ?? null,
        costPricePerUnitUgx:
          pharmacyMode && row.defaultCostUgx != null ? Math.max(1, Math.floor(row.defaultCostUgx)) : undefined,
        expiryDate:
          pharmacyMode && row.defaultExpiryDaysFromNow != null
            ? starterExpiryDateIso(row.defaultExpiryDaysFromNow)
            : null,
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
      case "restock":
        if (canRestock) setRestockProduct(p);
        break;
      default:
        break;
    }
  };

  const handleSimpleRestock = (input: {
    productId: string;
    packQty: number;
    costPerPackUgx: number;
    supplierId: string;
    supplierName: string;
    pharmacyRestock?: {
      unit: import("../types").PharmacySaleUnitType;
      invoiceTotalUgx: number;
      baseUnitsIn: number;
      costPerBaseUnitUgx: number;
    };
  }) => {
    if (input.pharmacyRestock) {
      const pr = input.pharmacyRestock;
      return recordPurchase({
        supplierId: input.supplierId,
        supplierName: input.supplierName,
        lines: [
          {
            productId: input.productId,
            baseUnitsIn: pr.baseUnitsIn,
            costPerBaseUnitUgx: pr.costPerBaseUnitUgx,
          },
        ],
        amountPaidUgx: pr.invoiceTotalUgx,
      });
    }
    const total = input.packQty * input.costPerPackUgx;
    return recordPurchase({
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      lines: [
        {
          productId: input.productId,
          qtyBuyingUnits: input.packQty,
          costPerBuyingUnitUgx: input.costPerPackUgx,
        },
      ],
      amountPaidUgx: total,
    });
  };

  const onlyProductInStock = unlockedProducts.length === 1;

  const renderProductCards = (items: Product[]) => {
    if (items.length === 0) {
      return (
        <p className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-base font-semibold text-slate-500">
          {t(lang, "stockNoListMatch")}
        </p>
      );
    }

    return (
      <ul className="space-y-3">
        {items.map((p) => (
          <StockProductCard
            key={p.id}
            lang={lang}
            product={p}
            locked={isProductPlanLocked(p.id, lockedIds)}
            canAdd={canAdd}
            canRemove={canRemove}
            canSell={canSell}
            canRestock={canRestock}
            isOnlyProduct={onlyProductInStock}
            onAction={(action) => handleRowAction(p, action)}
          />
        ))}
      </ul>
    );
  };

  const handleStockTabChange = (tab: StockHubTab) => {
    setStockTab(tab);
    if (tab !== "shelves") setSelectedShelf(null);
  };

  return (
    <div className="page-content-pad space-y-5">
      <PageHeader
        lang={lang}
        title={modeTerm("stockTitle")}
        subtitle={modeTerm("stockPageSub")}
        backLabel={t(lang, "officeBackToHub")}
      />

      {freeProductLimitReached ? (
        <section className="rounded-3xl border-2 border-orange-200 bg-orange-50 p-5 shadow-sm">
          <p className="text-lg font-black text-orange-950">{pt("freeLimitProductsTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-orange-950/80">
            {tTemplate(lang, "freeLimitProductsBody", { count: String(productLimit ?? 7) })}
          </p>
          {lockedProductCount > 0 ? (
            <p className="mt-2 text-sm font-bold text-orange-950">
              {t(lang, "freePlanLockedProductsNotice")
                .replace("{{locked}}", String(lockedProductCount))
                .replace("{{limit}}", String(productLimit ?? 7))}
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

      {unlockedProducts.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-waka-200 bg-gradient-to-b from-waka-50/80 to-white px-6 py-10 text-center">
          <p className="text-xl font-black text-slate-900">{modeTerm("stockEmptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-sm text-base text-slate-600">{modeTerm("stockEmptySub")}</p>
          {canAdd ? (
            <div className="mx-auto mt-6 flex w-full max-w-xs flex-col gap-2">
              <button
                type="button"
                disabled={freeProductLimitReached}
                onClick={openAddProductSheet}
                className="w-full rounded-2xl bg-waka-600 px-6 py-4 text-lg font-black text-white shadow-md active:bg-waka-700"
              >
                {modeTerm("stockAddProduct")}
              </button>
              {aiProductAssistantEnabled ? (
                <button
                  type="button"
                  disabled={freeProductLimitReached}
                  onClick={openAiProductAssist}
                  className="w-full rounded-2xl border-2 border-violet-300 bg-violet-50 px-6 py-3 text-base font-black text-violet-950"
                >
                  {t(lang, "aiProductAssistBtn")}
                </button>
              ) : null}
            </div>
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
        <>
          <StockSectionTabs lang={lang} active={stockTab} onChange={handleStockTabChange} />

          {stockTab === "overview" ? (
            <StockOverviewPanel
              lang={lang}
              totalProducts={unlockedProducts.length}
              lowStockCount={lowStockCount}
              outOfStockCount={outOfStockCount}
              inventoryValueUgx={inventoryValueUgx}
              canAdd={canAdd}
              canRestock={canRestock}
              freeProductLimitReached={freeProductLimitReached}
              onAddProduct={openAddProductSheet}
              aiProductAssistantEnabled={aiProductAssistantEnabled}
              onAddProductWithAi={openAiProductAssist}
              onBulkInventoryWithAi={aiInventoryAssistantEnabled ? openBulkInventoryAi : undefined}
            />
          ) : null}

          {stockTab === "products" ? (
            <section className="space-y-4">
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
              {groupByCategory && categoryGroups && listableProducts.length > 0 ? (
                <div className="space-y-5">
                  {categoryGroups.keys.map((gk) => (
                    <div key={gk}>
                      <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-waka-800">
                        {gk === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : gk}
                      </h3>
                      {renderProductCards(categoryGroups.map.get(gk) ?? [])}
                    </div>
                  ))}
                </div>
              ) : (
                renderProductCards(listableProducts)
              )}
            </section>
          ) : null}

          {stockTab === "shelves" ? (
            <section className="space-y-4">
              {selectedShelf ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedShelf(null)}
                    className="text-sm font-bold text-waka-800 underline-offset-2 hover:underline"
                  >
                    {t(lang, "stockShelfBack")}
                  </button>
                  <h2 className="text-lg font-black text-slate-900">
                    {selectedShelf === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : selectedShelf}
                  </h2>
                  {renderProductCards(productsInSelectedShelf)}
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600">{t(lang, "stockShelvesHint")}</p>
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {shelfFolders.map((shelf) => {
                      const label = shelf === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : shelf;
                      const count = shelfProductCounts.get(shelf) ?? 0;
                      return (
                        <li key={shelf}>
                          <button
                            type="button"
                            onClick={() => setSelectedShelf(shelf)}
                            className="flex min-h-[72px] w-full items-center gap-3 rounded-[1.35rem] border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-slate-50"
                          >
                            <span className="text-2xl">{shelfIconFor(label) ?? "📦"}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-base font-black text-slate-900">{label}</span>
                              <span className="mt-0.5 block text-sm font-semibold text-slate-500">
                                {tTemplate(lang, "stockShelfProductCount", { count: String(count) })}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          ) : null}

          {stockTab === "low" ? (
            <section className="space-y-4">
              {lowStockProducts.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 px-4 py-10 text-center text-base font-semibold text-emerald-900">
                  {t(lang, "stockLowStockEmpty")}
                </p>
              ) : (
                renderProductCards(lowStockProducts)
              )}
            </section>
          ) : null}

          {stockTab === "movements" ? (
            <StockMovementsPanel lang={lang} movements={recentMovements} pharmacyMode={pharmacyMode} wholesaleMode={wholesaleMode} />
          ) : null}
        </>
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
            <p className="text-center text-xl font-black text-slate-900">
              {industryPlaceholderMode
                ? uiPlaceholder(
                    lang,
                    preferences.businessType,
                    "quickAddTitle",
                    preferences.pharmacyModeEnabled,
                    preferences.hospitalityModeEnabled,
                  )
                : t(lang, "stockQuickAddTitle")}
            </p>
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
                businessType={preferences.businessType}
                pharmacyModeEnabled={preferences.pharmacyModeEnabled}
                hospitalityModeEnabled={preferences.hospitalityModeEnabled}
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
                {industryPlaceholderMode
                  ? uiPlaceholder(
                      lang,
                      preferences.businessType,
                      "quickAddSave",
                      preferences.pharmacyModeEnabled,
                      preferences.hospitalityModeEnabled,
                    )
                  : t(lang, "quickAddSave")}
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

      {pharmacyMode && !wizardPrefill ? (
        <PharmacyAddMedicineWizard
          lang={lang}
          open={bulkOpen}
          onClose={closeAddProductWizard}
          shelves={stockCategoryPicklist}
          disabled={freeProductLimitReached}
          onSaved={() => {}}
        />
      ) : (
        <SimpleAddProductWizard
          lang={lang}
          open={bulkOpen}
          onClose={closeAddProductWizard}
          shelves={stockCategoryPicklist}
          generalCategoryLabel={t(lang, "generalCategory")}
          disabled={freeProductLimitReached}
          onSave={saveFromSimpleWizard}
          prefill={wizardPrefill}
          initialStep={wizardInitialStep}
        />
      )}

      {aiInventoryAssistantEnabled ? (
        <BulkInventoryAiModal
          lang={lang}
          open={bulkAiOpen}
          onClose={() => setBulkAiOpen(false)}
          businessType={preferences.businessType}
          shopName={preferences.shopDisplayName ?? ""}
          productSlotsLeft={productSlotsLeft}
          onImport={handleBulkAiImport}
        />
      ) : null}

      {aiProductAssistantEnabled ? (
        <AiProductAssistSheet
          lang={lang}
          open={aiAssistOpen}
          onClose={() => setAiAssistOpen(false)}
          businessType={preferences.businessType}
          onContinue={handleAiContinue}
          onContinueManual={handleAiContinueManual}
        />
      ) : null}

      <StockProductEditModal
        lang={lang}
        product={editProduct}
        open={editProduct !== null}
        onClose={() => setEditProduct(null)}
        canPresets={canPresets}
        updateProduct={updateProduct}
        categorySuggestions={stockCategoryPicklist}
      />

      <SimpleProductRestockModal
        lang={lang}
        open={restockProduct !== null}
        product={restockProduct}
        suppliers={suppliers}
        onClose={() => setRestockProduct(null)}
        onSave={handleSimpleRestock}
      />

      <ProductLockedModal lang={lang} open={productLockedOpen} onClose={() => setProductLockedOpen(false)} />

      {removeId ? (
        <AppModalOverlay className="z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
          <div className="max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <p className="text-lg font-black text-slate-900">
              {onlyProductInStock ? t(lang, "removeLastProductConfirmTitle") : t(lang, "removeProductConfirm")}
            </p>
            {onlyProductInStock ? (
              <p className="mt-2 text-sm font-semibold text-slate-600">{t(lang, "removeLastProductConfirmBody")}</p>
            ) : null}
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
