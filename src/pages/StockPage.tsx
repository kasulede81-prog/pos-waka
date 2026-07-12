import { actorHasPermission } from "../lib/actorAuthorization";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import type { Language, Product } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isLowStock } from "../lib/sellingEngine";
import { inventoryValueAtCostUgx } from "../lib/costPrecision";
import { starterPackForBusinessType, starterExpiryDateIso, type StarterLine } from "../data/starterPacks";
import { PharmacyAddMedicineWizard } from "../components/stock/PharmacyAddMedicineWizard";
import { useSessionActor } from "../context/SessionActorContext";

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
import { inferProductGuess, uiPlaceholder } from "../lib/pharmacyUx";
import { usePageLoadMark } from "../hooks/usePageLoadMark";
import { QuickAddProductFields } from "../components/stock/QuickAddProductFields";
import { StockListToolbar } from "../components/stock/StockListToolbar";
import { InventoryViewProvider } from "../features/inventory/viewEngine/InventoryViewContext";
import { InventoryViewSwitcher } from "../features/inventory/viewEngine/InventoryViewSwitcher";
import { InventoryProductList } from "../features/inventory/viewEngine/InventoryProductList";
import {
  buildInventorySearchIndex,
  queryInventoryProducts,
} from "../features/inventory/viewEngine/inventoryProductListQuery";
import { InventorySelectionProvider } from "../features/inventory/selection/InventorySelectionProvider";
import { InventorySelectionToolbar } from "../features/inventory/selection/InventorySelectionToolbar";
import { InventorySelectionModeButton } from "../features/inventory/selection/InventorySelectionModeButton";
import { InventoryFilterBar, useInventorySavedFilters } from "../features/inventory/filters/InventoryFilterBar";
import { defaultInventoryAdvancedFilters, mergeAdvancedFilters } from "../features/inventory/filters/types";
import { buildLastSupplierByProductId } from "../features/inventory/filters/inventoryAdvancedFilters";
import { StockInventoryProductivityChrome } from "../features/inventory/StockInventoryProductivityChrome";
import { StockSectionTabs, type StockHubTab } from "../components/stock/StockSectionTabs";
import { StockOverviewPanel } from "../components/stock/StockOverviewPanel";
import { StockMovementsPanel } from "../components/stock/StockMovementsPanel";
import { SimpleProductRestockModal } from "../components/stock/SimpleProductRestockModal";
import { StockPinnedSearch } from "../components/stock/StockPinnedSearch";
import { StockShelfGrid } from "../components/stock/StockShelfGrid";
import { StockFab } from "../components/stock/StockFab";
import { EmptyShelfPanel } from "../components/stock/EmptyShelfPanel";
import { WakaCheckbox } from "../components/enterprise/WakaCheckbox";
import { InventoryStatGrid } from "../components/stock/InventoryStatGrid";
import { StockProductDetailSheet } from "../components/stock/StockProductDetailSheet";
import { StockProductActionSheet } from "../components/stock/StockProductActionSheet";
import {
  productToWizardPrefill,
  resolveWizardEditCostPatch,
  type BuiltWizardProduct,
} from "../lib/simpleProductWizard";
import { ModalSheet } from "../components/layout/ModalSheet";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { Package } from "lucide-react";
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
} from "../lib/productCategories";
import {
  QUICK_SELL_SHELF_KEY,
  collectShelfCategoryKeys,
  shelfHasUncategorizedSlot,
} from "../lib/posShelfLayout";
import { defaultMenuCategoriesForBusinessType, isHospitalityMode } from "../lib/hospitality";
import { defaultPharmacyCategoriesForBusinessType, isPharmacyMode } from "../lib/pharmacy";
import { shouldTrackBatchesForProduct } from "../lib/pharmacyStoreBatch";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isWholesaleMode } from "../lib/wholesale";
import { useWholesaleTerms } from "../lib/wholesaleTerms";
import { detectBarcodeCapabilities, startBarcodeSession, stopBarcodeSession } from "../services/hardware/barcodeAdapter";
import { PharmacyBatchDetailSheet, type PharmacyBatchDetailAction } from "../components/pharmacy/PharmacyBatchDetailSheet";
import { PharmacyReceiveBatchSheet } from "../components/pharmacy/PharmacyReceiveBatchSheet";
import {
  PharmacyBatchAdjustmentSheet,
  type PharmacyBatchAdjustmentKind,
} from "../components/pharmacy/PharmacyBatchAdjustmentSheet";
import { findProductByBarcode } from "../lib/pharmacyMedicine";

type StarterRowState = StarterLine & { enabled: boolean; priceStr: string; stockStr: string };

export function StockPage({ lang, workspaceEmbed }: { lang: Language; workspaceEmbed?: boolean }) {
  usePageLoadMark("stock");
  const actor = useSessionActor();
  const { snapshot } = useSubscription();
  const canRemove = actorHasPermission(actor, "products.remove");
  const canAdjust = actorHasPermission(actor, "stock.adjust");
  const canAdd = actorHasPermission(actor, "products.add");
  const canPresets = actorHasPermission(actor, "products.edit_presets");
  const canSell = actorHasPermission(actor, "pos.sell");
  const canRestock = actorHasPermission(actor, "purchases.record");
  const canArrangeShelves = actorHasPermission(actor, "shelves.customize");

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
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

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
  const [searchParams] = useSearchParams();
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [receiveProduct, setReceiveProduct] = useState<Product | null>(null);
  const [batchAdj, setBatchAdj] = useState<{ product: Product; kind: PharmacyBatchAdjustmentKind } | null>(null);
  const [actionSheetProduct, setActionSheetProduct] = useState<Product | null>(null);

  const navigate = useNavigate();
  const [listQuery, setListQuery] = useState("");
  const [listSort, setListSort] = useState<"name_az" | "name_za" | "stock_low" | "updated">("name_az");
  const [listFilter, setListFilter] = useState<"all" | "low">("all");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [stockCategoryFilter, setStockCategoryFilter] = useState<string>(CATEGORY_FILTER_ALL);
  const [stockGroupByCategoryOverride, setStockGroupByCategoryOverride] = useState<boolean | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState(() => defaultInventoryAdvancedFilters(CATEGORY_FILTER_ALL));
  const [visibleProductIds, setVisibleProductIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { presets: savedFilterPresets, save: saveFilterPreset } = useInventorySavedFilters();

  useEffect(() => {
    const caps = detectBarcodeCapabilities();
    if (!caps.hidWedge) return;
    void startBarcodeSession("hid", {
      onScan: (code) => {
        setStockTab("products");
        setListQuery(code);
        if (pharmacyMode) {
          const hit = findProductByBarcode(products, code);
          if (hit) setDetailProduct(hit);
        }
      },
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [pharmacyMode, products]);

  useEffect(() => {
    if (workspaceEmbed) {
      const view = searchParams.get("stockView");
      if (view === "shelves" || view === "low" || view === "movements" || view === "overview") {
        setStockTab(view);
      } else {
        setStockTab("products");
      }
      const q = searchParams.get("q");
      if (q) setListQuery(q);
      return;
    }
    const tab = searchParams.get("tab");
    if (tab === "shelves" || tab === "products" || tab === "low" || tab === "movements" || tab === "overview") {
      setStockTab(tab);
    }
    const shelf = searchParams.get("shelf");
    if (shelf) {
      setStockTab("shelves");
      setSelectedShelf(shelf);
      if (searchParams.get("add") === "1" && canAdd && !freeProductLimitReached) {
        const shelfName = shelf === UNCATEGORIZED_SENTINEL ? "" : shelf;
        setWizardPrefill({
          name: "",
          shelf: shelfName,
          sellUnit: "piece",
          sellUnitCustom: "",
          hasPack: false,
          packKind: "crate",
          packCustom: "",
          piecesPerPack: "",
        });
        setWizardInitialStep("name");
        setBulkOpen(true);
      }
    }
  }, [searchParams, workspaceEmbed, canAdd, freeProductLimitReached]);

  useEffect(() => {
    const productId = searchParams.get("productId");
    if (!productId || !pharmacyMode) return;
    const hit = products.find((p) => p.id === productId);
    if (hit) {
      setDetailProduct(hit);
      setStockTab("products");
    }
  }, [searchParams, products, pharmacyMode]);

  const guessPreview = useMemo(() => {
    const n = qaName.trim();
    if (!n) return null;
    return inferProductGuess(n, preferences.businessType, preferences.pharmacyModeEnabled);
  }, [qaName, preferences.businessType, preferences.pharmacyModeEnabled]);

  const defaultGroupByCategory = products.length > 12 && products.length <= 250;
  const groupByCategory = stockGroupByCategoryOverride ?? defaultGroupByCategory;

  const savedShelfKeys = useMemo(() => {
    const order = preferences.posPinnedShelfKeys ?? [];
    const layout = Object.keys(preferences.posShelfLayout ?? {});
    return [...new Set([...order, ...layout])].filter(
      (k) => k && k !== QUICK_SELL_SHELF_KEY,
    );
  }, [preferences.posPinnedShelfKeys, preferences.posShelfLayout]);

  const stockCategoryPicklist = useMemo(() => {
    const fromProducts = distinctTrimmedCategories(products);
    const fromSaved = savedShelfKeys.filter((k) => k !== UNCATEGORIZED_SENTINEL);
    if (isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
      const presets = defaultMenuCategoriesForBusinessType(preferences.businessType);
      return [...new Set([...fromProducts, ...fromSaved, ...presets])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    if (pharmacyMode) {
      const presets = defaultPharmacyCategoriesForBusinessType(preferences.businessType);
      return [...new Set([...fromProducts, ...fromSaved, ...presets])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    return collectShelfCategoryKeys(products, savedShelfKeys, preferences.posShelfLayout ?? {});
  }, [products, preferences.businessType, preferences.hospitalityModeEnabled, preferences.posShelfLayout, pharmacyMode, savedShelfKeys]);
  const stockHasUncategorized = useMemo(
    () =>
      shelfHasUncategorizedSlot(
        products,
        preferences.posPinnedShelfKeys ?? [],
        preferences.posShelfLayout ?? {},
      ),
    [products, preferences.posPinnedShelfKeys, preferences.posShelfLayout],
  );

  const productSearchIndex = useMemo(
    () => buildInventorySearchIndex(products, preferences, stockMovements),
    [products, preferences, stockMovements],
  );

  const lastSupplierByProductId = useMemo(() => {
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return buildLastSupplierByProductId(stockMovements, names);
  }, [stockMovements, suppliers]);

  const filterContext = useMemo(
    () => ({ preferences, lastSupplierByProductId }),
    [preferences, lastSupplierByProductId],
  );

  const listableProducts = useMemo(
    () =>
      queryInventoryProducts({
        products,
        query: listQuery,
        categoryFilter: stockCategoryFilter,
        listFilter,
        sort: listSort,
        index: productSearchIndex,
        advancedFilters,
        filterContext,
        stockMovements,
      }),
    [
      products,
      listQuery,
      listFilter,
      listSort,
      stockCategoryFilter,
      productSearchIndex,
      advancedFilters,
      filterContext,
      stockMovements,
    ],
  );

  const lowStockCount = useMemo(() => unlockedProducts.filter((p) => isLowStock(p)).length, [unlockedProducts]);
  const inventoryValueUgx = useMemo(() => inventoryValueAtCostUgx(unlockedProducts), [unlockedProducts]);
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
    const shelfProducts = unlockedProducts.filter(
      (p) => (normalizedCategoryKey(p) || UNCATEGORIZED_SENTINEL) === selectedShelf,
    );
    return queryInventoryProducts({
      products: shelfProducts,
      query: listQuery,
      categoryFilter: CATEGORY_FILTER_ALL,
      listFilter: "all",
      sort: "name_az",
      index: productSearchIndex,
      advancedFilters,
      filterContext,
      stockMovements,
    });
  }, [selectedShelf, unlockedProducts, listQuery, productSearchIndex, advancedFilters, filterContext, stockMovements]);

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
    setEditingProduct(null);
  };

  const openAddProductSheet = () => {
    if (freeProductLimitReached) return;
    setWizardPrefill(undefined);
    setWizardInitialStep(undefined);
    setBulkOpen(true);
  };

  const openAddProductForShelf = (shelfKey: string) => {
    if (freeProductLimitReached) return;
    const shelfName = shelfKey === UNCATEGORIZED_SENTINEL ? "" : shelfKey;
    setWizardPrefill({
      name: "",
      shelf: shelfName,
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

  const saveFromSimpleWizard = (
    built: BuiltWizardProduct | null,
    opts?: { auditReason?: string },
  ): boolean => {
    if (!built) return false;
    if (editingProduct) {
      const r = updateProduct(
        editingProduct.id,
        {
          name: built.name,
          category: built.category || t(lang, "generalCategory"),
          baseUnit: built.baseUnit,
          buyingUnit: built.buyingUnit ?? null,
          conversionRate: built.conversionRate ?? null,
          sellingPricePerUnitUgx: built.priceUgx,
          costPricePerUnitUgx: resolveWizardEditCostPatch(built, editingProduct),
          buyingPackCostUgx: built.buyingPackCostUgx ?? null,
          stockOnHand: built.stockQty,
          sellingMode: built.sellingMode,
          quickPresetsMoneyUgx: built.quickPresetsMoneyUgx,
          quickPresetsQty: built.quickPresetsQty,
        },
        opts?.auditReason ? { auditReason: opts.auditReason } : undefined,
      );
      if (!r.ok) {
        window.alert(t(lang, r.errorKey === "auditReasonRequired" ? "auditReasonRequired" : (r.errorKey ?? "invalid")));
      }
      return r.ok;
    }
    if (freeProductLimitReached) return false;
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
      buyingPackCostUgx: built.buyingPackCostUgx ?? null,
      quickPresetsMoneyUgx: built.quickPresetsMoneyUgx,
      quickPresetsQty: built.quickPresetsQty,
      inferName: built.inferName,
    });
    return r.ok;
  };

  const openEditProduct = (p: Product) => {
    if (pharmacyMode) {
      setEditProduct(p);
      return;
    }
    setEditingProduct(p);
    setWizardPrefill(productToWizardPrefill(p, lang));
    setWizardInitialStep("name");
    setBulkOpen(true);
  };

  const handleBatchDetailAction = (p: Product, action: PharmacyBatchDetailAction) => {
    switch (action) {
      case "receive":
        setReceiveProduct(p);
        break;
      case "adjust":
        setDetailProduct(null);
        openEditProduct(p);
        break;
      case "writeoff":
        setDetailProduct(null);
        setBatchAdj({ product: p, kind: "writeoff" });
        break;
      case "return":
        setDetailProduct(null);
        setBatchAdj({ product: p, kind: "supplier_return" });
        break;
      case "transfer":
        setDetailProduct(null);
        navigate("/stock/transfer");
        break;
      case "print":
        window.print();
        break;
      default:
        break;
    }
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
    const r = removeProduct(id, removeReason);
    if (!r.ok) {
      window.alert(t(lang, r.errorKey === "auditReasonRequired" ? "auditReasonRequired" : (r.errorKey ?? "invalid")));
      return;
    }
    setRemoveId(null);
    setRemoveReason("");
  };

  const openProductRestock = (p: Product) => {
    if (shouldTrackBatchesForProduct(preferences.businessType, preferences.pharmacyModeEnabled, p)) {
      setReceiveProduct(p);
      return;
    }
    setRestockProduct(p);
  };

  const handleRowAction = (p: Product, action: string) => {
    if (isProductPlanLocked(p.id, lockedIds)) {
      setProductLockedOpen(true);
      return;
    }
    switch (action) {
      case "edit":
        if (canAdd) openEditProduct(p);
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
        if (canRestock) openProductRestock(p);
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

  const renderProductList = (items: Product[], variant: "default" | "lowStock" = "default") => {
    if (items.length === 0) {
      return (
        <p className="rounded-xl bg-muted px-3 py-8 text-center text-sm font-semibold text-muted-foreground">
          {t(lang, "stockNoListMatch")}
        </p>
      );
    }

    return (
      <InventoryProductList
        lang={lang}
        products={items}
        preferences={preferences}
        lockedIds={lockedIds}
        canAdd={canAdd}
        canRemove={canRemove}
        canSell={canSell}
        canRestock={canRestock}
        isOnlyProduct={onlyProductInStock}
        variant={variant}
        listSort={listSort}
        onListSort={setListSort}
        onAction={handleRowAction}
        onOpenDetail={setDetailProduct}
        onVisibleIdsChange={setVisibleProductIds}
      />
    );
  };

  const shelfGridItems = useMemo(
    () =>
      shelfFolders.map((key) => ({
        key,
        label: key === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : key,
        count: shelfProductCounts.get(key) ?? 0,
      })),
    [shelfFolders, shelfProductCounts, lang],
  );

  const handlePinnedSearch = (q: string) => {
    setListQuery(q);
    if (q.trim() && (stockTab === "overview" || stockTab === "shelves")) {
      setStockTab("products");
    }
  };

  const showPinnedSearch = unlockedProducts.length > 0 && stockTab !== "movements";

  const handleStockTabChange = (tab: StockHubTab) => {
    setStockTab(tab);
    if (tab !== "shelves") setSelectedShelf(null);
  };

  return (
    <InventoryViewProvider>
    <InventorySelectionProvider>
    <EnterprisePageContainer className="space-y-3" variant={workspaceEmbed ? "flush" : "default"}>
      {!workspaceEmbed ? (
        <EnterprisePageHeader
          lang={lang}
          title={modeTerm("stockTitle")}
          subtitle={modeTerm("stockPageSub")}
          backLabel={t(lang, "officeBackToHub")}
          compact
        />
      ) : null}

      {!workspaceEmbed && actorHasPermission(actor, "stock.count") ? (
        <Link
          to="/stock/count"
          className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-950"
        >
          {t(lang, "stockCountNav")}
        </Link>
      ) : null}

      {freeProductLimitReached ? (
        <section className="rounded-3xl border-2 border-waka-200 bg-waka-50 p-5 shadow-sm">
          <p className="text-lg font-black text-waka-950">{pt("freeLimitProductsTitle")}</p>
          <p className="mt-1 text-sm font-semibold text-waka-950/80">
            {tTemplate(lang, "freeLimitProductsBody", { count: String(productLimit ?? 7) })}
          </p>
          {lockedProductCount > 0 ? (
            <p className="mt-2 text-sm font-bold text-waka-950">
              {t(lang, "freePlanLockedProductsNotice")
                .replace("{{locked}}", String(lockedProductCount))
                .replace("{{limit}}", String(productLimit ?? 7))}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link to="/upgrade" className="rounded-2xl bg-foreground px-4 py-3 text-center text-sm font-black text-background">
              {t(lang, "freeLimitUpgrade")}
            </Link>
            <Link
              to="/support"
              className="rounded-2xl border-2 border-waka-300 bg-card px-4 py-3 text-center text-sm font-black text-waka-950"
            >
              {t(lang, "freeLimitSupport")}
            </Link>
          </div>
        </section>
      ) : null}

      {unlockedProducts.length === 0 ? (
        <EnterpriseEmptyState
          icon={Package}
          title={modeTerm("stockEmptyTitle")}
          description={modeTerm("stockEmptySub")}
        >
          {canAdd ? (
            <div className="mx-auto mt-6 flex w-full max-w-xs flex-col gap-2">
              <WakaButton type="button" disabled={freeProductLimitReached} onClick={openAddProductSheet}>
                {modeTerm("stockAddProduct")}
              </WakaButton>
              {aiProductAssistantEnabled ? (
                <WakaButton type="button" variant="secondary" disabled={freeProductLimitReached} onClick={openAiProductAssist}>
                  {t(lang, "aiProductAssistBtn")}
                </WakaButton>
              ) : null}
              <WakaButton type="button" variant="ghost" disabled={freeProductLimitReached} onClick={openStarter}>
                {t(lang, "starterPackOpen")}
              </WakaButton>
            </div>
          ) : null}
        </EnterpriseEmptyState>
      ) : (
        <>
          {stockTab !== "movements" ? (
            <InventoryStatGrid
              lang={lang}
              totalProducts={unlockedProducts.length}
              lowStockCount={lowStockCount}
              shelfCount={shelfFolders.length}
              inventoryValueUgx={inventoryValueUgx}
              onLowStockTap={() => setStockTab("low")}
            />
          ) : null}

          <div
            className={clsx(
              "sticky top-0 z-20 -mx-3 space-y-2 border-b border-border/80 bg-muted/95 px-3 py-2 backdrop-blur-md",
              "supports-[backdrop-filter]:bg-muted/88 md:-mx-6 md:px-6",
            )}
          >
            <StockSectionTabs lang={lang} active={stockTab} onChange={handleStockTabChange} />
            {showPinnedSearch ? (
              <StockPinnedSearch lang={lang} value={listQuery} onChange={handlePinnedSearch} />
            ) : null}
          </div>

          {stockTab === "overview" ? (
            <StockOverviewPanel
              lang={lang}
              canAdd={canAdd}
              canRestock={canRestock}
              canArrangeShelves={canArrangeShelves}
              freeProductLimitReached={freeProductLimitReached}
              onAddProduct={openAddProductSheet}
              showImport={aiInventoryAssistantEnabled}
              onImportProducts={openBulkInventoryAi}
            />
          ) : null}

          {stockTab === "products" ? (
            <section className="space-y-3">
              <InventoryFilterBar
                lang={lang}
                filters={advancedFilters}
                onChange={setAdvancedFilters}
                query={listQuery}
                onQueryChange={setListQuery}
                products={products}
                suppliers={suppliers}
                lastSupplierByProductId={lastSupplierByProductId}
                stockCategoryPicklist={stockCategoryPicklist}
                savedPresets={savedFilterPresets}
                onSavePreset={(name) => saveFilterPreset(name, advancedFilters, listQuery)}
                onApplyPreset={(preset) => {
                  setAdvancedFilters(
                    mergeAdvancedFilters(
                      defaultInventoryAdvancedFilters(CATEGORY_FILTER_ALL),
                      preset.filters,
                    ),
                  );
                  setListQuery(preset.query);
                }}
                compact
              />
              <InventorySelectionToolbar
                lang={lang}
                visibleIds={visibleProductIds}
                filteredIds={listableProducts.map((p) => p.id)}
              />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <StockListToolbar
                    lang={lang}
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
                    compact
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <InventorySelectionModeButton lang={lang} />
                  <InventoryViewSwitcher lang={lang} variant="toolbar" />
                </div>
              </div>
              {groupByCategory && categoryGroups && listableProducts.length > 0 ? (
                <div className="space-y-4">
                  {categoryGroups.keys.map((gk) => (
                    <div key={gk}>
                      <h3 className="mb-2 px-0.5 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                        {gk === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : gk}
                      </h3>
                      {renderProductList(categoryGroups.map.get(gk) ?? [])}
                    </div>
                  ))}
                </div>
              ) : (
                renderProductList(listableProducts)
              )}
            </section>
          ) : null}

          {stockTab === "shelves" ? (
            <StockShelfGrid
              lang={lang}
              shelves={shelfGridItems}
              selectedShelf={selectedShelf}
              canArrangeShelves={canArrangeShelves}
              onSelectShelf={setSelectedShelf}
              onBack={() => setSelectedShelf(null)}
              shelfDetailHeader={
                selectedShelf ? (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <StockListToolbar
                        lang={lang}
                        listSort={listSort}
                        onListSort={setListSort}
                        listFilter="all"
                        onListFilter={() => undefined}
                        stockCategoryFilter={CATEGORY_FILTER_ALL}
                        onStockCategoryFilter={() => undefined}
                        stockCategoryPicklist={[]}
                        stockHasUncategorized={false}
                        groupByCategory={false}
                        onGroupByCategory={() => undefined}
                        compact
                      />
                    </div>
                    <InventoryViewSwitcher lang={lang} variant="inline" />
                  </div>
                ) : undefined
              }
            >
              {selectedShelf ? (
                productsInSelectedShelf.length === 0 ? (
                  <EmptyShelfPanel
                    lang={lang}
                    shelfLabel={
                      selectedShelf === UNCATEGORIZED_SENTINEL
                        ? t(lang, "uncategorized")
                        : selectedShelf
                    }
                    canAdd={canAdd && !freeProductLimitReached}
                    onAddProduct={() => openAddProductForShelf(selectedShelf)}
                  />
                ) : (
                  renderProductList(productsInSelectedShelf)
                )
              ) : null}
            </StockShelfGrid>
          ) : null}

          {stockTab === "low" ? (
            <section className="space-y-3">
              <div className="flex justify-end">
                <InventoryViewSwitcher lang={lang} variant="inline" />
              </div>
              {lowStockProducts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-3 py-8 text-center text-sm font-semibold text-emerald-900">
                  {t(lang, "stockLowStockEmpty")}
                </p>
              ) : (
                renderProductList(lowStockProducts, "lowStock")
              )}
            </section>
          ) : null}

          {stockTab === "movements" ? (
            <StockMovementsPanel lang={lang} movements={recentMovements} pharmacyMode={pharmacyMode} wholesaleMode={wholesaleMode} />
          ) : null}

          {canAdd && !freeProductLimitReached ? (
            <StockFab lang={lang} onClick={openAddProductSheet} />
          ) : null}
        </>
      )}

      <ModalSheet
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        align="center"
        zIndexClass="z-[70]"
        title={
          industryPlaceholderMode
            ? uiPlaceholder(
                lang,
                preferences.businessType,
                "quickAddTitle",
                preferences.pharmacyModeEnabled,
                preferences.hospitalityModeEnabled,
              )
            : t(lang, "stockQuickAddTitle")
        }
        footer={
          <div className="grid grid-cols-2 gap-3">
            <WakaButton type="button" variant="secondary" onClick={() => setQuickOpen(false)}>
              {t(lang, "cancel")}
            </WakaButton>
            <WakaButton type="submit" form="stock-quick-add-form">
              {industryPlaceholderMode
                ? uiPlaceholder(
                    lang,
                    preferences.businessType,
                    "quickAddSave",
                    preferences.pharmacyModeEnabled,
                    preferences.hospitalityModeEnabled,
                  )
                : t(lang, "quickAddSave")}
            </WakaButton>
          </div>
        }
      >
        <form id="stock-quick-add-form" onSubmit={submitQuick} className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">{t(lang, "stockQuickAddSub")}</p>
          {guessPreview ? (
            <p className="rounded-2xl bg-waka-50 px-3 py-2 text-sm font-semibold text-waka-900">
              {t(lang, "smartGuessHint")}: {t(lang, `mode_${guessPreview.sellingMode}`)} · {guessPreview.baseUnit}
            </p>
          ) : null}
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
        </form>
      </ModalSheet>

      <ModalSheet
        open={starterOpen}
        onClose={() => setStarterOpen(false)}
        align="center"
        zIndexClass="z-[56]"
        title={t(lang, "starterPackTitle")}
        footer={
          <div className="grid grid-cols-2 gap-3">
            <WakaButton type="button" variant="secondary" onClick={() => setStarterOpen(false)}>
              {t(lang, "cancel")}
            </WakaButton>
            <WakaButton type="button" onClick={applyStarter}>
              {t(lang, "starterPackApply")}
            </WakaButton>
          </div>
        }
      >
        <p className="text-center text-sm text-muted-foreground">{t(lang, "starterPackSub")}</p>
        <ul className="mt-4 space-y-3">
          {starterRows.map((row, i) => (
            <li key={`${row.nameKey}-${i}`} className="rounded-2xl border-2 border-border p-3">
              <WakaCheckbox
                checked={row.enabled}
                onCheckedChange={(checked) =>
                  setStarterRows((rows) => rows.map((r, j) => (j === i ? { ...r, enabled: checked } : r)))
                }
                label={<span className="flex-1 text-lg">{t(lang, row.nameKey)}</span>}
              />
              <div className="mt-2 grid grid-cols-2 gap-2 pl-9">
                <label className="text-xs font-bold text-muted-foreground">
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
                <label className="text-xs font-bold text-muted-foreground">
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
      </ModalSheet>

      {pharmacyMode && !wizardPrefill && !editingProduct ? (
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
          disabled={freeProductLimitReached && !editingProduct}
          onSave={saveFromSimpleWizard}
          prefill={wizardPrefill}
          initialStep={wizardInitialStep}
          editingProduct={editingProduct}
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

      {pharmacyMode ? (
        <StockProductEditModal
          lang={lang}
          product={editProduct}
          open={editProduct !== null}
          onClose={() => setEditProduct(null)}
          canPresets={canPresets}
          updateProduct={updateProduct}
          categorySuggestions={stockCategoryPicklist}
        />
      ) : null}

      <SimpleProductRestockModal
        lang={lang}
        open={restockProduct !== null}
        product={restockProduct}
        suppliers={suppliers}
        onClose={() => setRestockProduct(null)}
        onSave={handleSimpleRestock}
      />

      <ProductLockedModal lang={lang} open={productLockedOpen} onClose={() => setProductLockedOpen(false)} />

      <ModalSheet
        open={removeId !== null}
        onClose={() => {
          setRemoveId(null);
          setRemoveReason("");
        }}
        align="center"
        zIndexClass="z-[60]"
        title={onlyProductInStock ? t(lang, "removeLastProductConfirmTitle") : t(lang, "removeProductConfirm")}
        footer={
          <div className="flex gap-3">
            <WakaButton
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setRemoveId(null);
                setRemoveReason("");
              }}
            >
              {t(lang, "cancel")}
            </WakaButton>
            <WakaButton type="button" variant="danger" className="flex-1" onClick={() => removeId && confirmRemove(removeId)}>
              {t(lang, "removeProduct")}
            </WakaButton>
          </div>
        }
      >
        {onlyProductInStock ? (
          <p className="text-sm font-semibold text-muted-foreground">{t(lang, "removeLastProductConfirmBody")}</p>
        ) : null}
        <label className="mt-4 block">
          <span className="text-sm font-bold text-foreground">{t(lang, "auditReasonLabel")}</span>
          <textarea
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
            className="mt-2 min-h-[80px] w-full rounded-2xl border-2 border-border px-4 py-3 text-sm font-semibold outline-none focus:border-waka-500"
            placeholder={t(lang, "auditReasonPlaceholder")}
          />
        </label>
      </ModalSheet>

      <StockProductDetailSheet
        lang={lang}
        open={!pharmacyMode && detailProduct !== null}
        product={detailProduct}
        preferences={preferences}
        locked={detailProduct ? lockedIds.has(detailProduct.id) : false}
        canAdd={canAdd}
        canSell={canSell}
        onClose={() => setDetailProduct(null)}
        onSell={() => detailProduct && handleRowAction(detailProduct, "sell")}
        onEdit={() => detailProduct && handleRowAction(detailProduct, "edit")}
        onMore={() => {
          if (detailProduct) {
            setActionSheetProduct(detailProduct);
            setDetailProduct(null);
          }
        }}
      />

      {pharmacyMode && detailProduct ? (
        <PharmacyBatchDetailSheet
          lang={lang}
          product={detailProduct}
          open
          onClose={() => setDetailProduct(null)}
          canReceive={canRestock}
          canAdjust={canAdd}
          canWriteOff={canAdjust}
          canReturn={canRestock}
          onAction={(action) => handleBatchDetailAction(detailProduct, action)}
        />
      ) : null}

      {receiveProduct ? (
        <PharmacyReceiveBatchSheet
          lang={lang}
          product={receiveProduct}
          open
          onClose={() => setReceiveProduct(null)}
          onDone={() => {
            const fresh = products.find((p) => p.id === receiveProduct.id);
            if (fresh) setDetailProduct(fresh);
          }}
        />
      ) : null}

      {batchAdj ? (
        <PharmacyBatchAdjustmentSheet
          lang={lang}
          product={batchAdj.product}
          kind={batchAdj.kind}
          open
          onClose={() => setBatchAdj(null)}
          onDone={() => {
            const fresh = products.find((p) => p.id === batchAdj.product.id);
            if (fresh) setDetailProduct(fresh);
          }}
        />
      ) : null}

      <StockProductActionSheet
        lang={lang}
        open={actionSheetProduct !== null}
        productName={actionSheetProduct?.name ?? ""}
        canAdd={canAdd}
        canRestock={canRestock}
        canRemove={canRemove}
        onClose={() => setActionSheetProduct(null)}
        onAction={(action) => {
          if (actionSheetProduct) handleRowAction(actionSheetProduct, action);
          setActionSheetProduct(null);
        }}
      />
      <StockInventoryProductivityChrome
        lang={lang}
        enabled={stockTab === "products" || stockTab === "low" || (stockTab === "shelves" && selectedShelf !== null)}
        products={products}
        filteredProducts={listableProducts}
        preferences={preferences}
        suppliers={suppliers}
        canEdit={canAdd}
        canAdjust={canAdjust}
        stockCategoryPicklist={stockCategoryPicklist}
        searchInputRef={searchInputRef}
        filteredIds={listableProducts.map((p) => p.id)}
      />
    </EnterprisePageContainer>
    </InventorySelectionProvider>
    </InventoryViewProvider>
  );
}
