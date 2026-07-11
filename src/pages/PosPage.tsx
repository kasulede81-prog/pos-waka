import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useShallow } from "zustand/react/shallow";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Banknote, ScanLine, Search, X } from "lucide-react";
import type { Language, LineInputMode, PharmacySaleUnitType, PosShelfLayoutConfig, Product, SaleLine } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { VirtualizedProductGrid } from "../components/pos/VirtualizedProductGrid";
import { PosCheckoutPanel } from "../components/pos/PosCheckoutPanel";
import { PosOperationalNav } from "../components/pos/PosOperationalNav";
import { PosSellHeroCard } from "../components/pos/PosSellHeroCard";
import { PosSellActionChip, PosSellActionChips } from "../components/pos/PosSellActionChips";
import { summarizeTodaySales } from "../lib/todaySalesSummary";
import { usePosLayoutMode } from "../hooks/usePosLayoutMode";
import { usePosViewportWidth } from "../hooks/usePosViewportWidth";
import { posSplitGridTemplateColumns } from "../lib/posDesktopSplit";
import { useCatalogContainerWidth } from "../hooks/useCatalogContainerWidth";
import { resolveConfirmSaleAction } from "../lib/posCheckoutFocus";
import { resolveScanToCartInput } from "../lib/posScanToCart";
import {
  applyMoneyInputKey,
  isActiveMoneyInput,
  isPosShortcutModalOpen,
  resolvePosShortcutAction,
  shouldBlockPosShortcutAction,
  type PosShortcutModalState,
} from "../lib/posKeyboardShortcuts";
import {
  shouldMountCompactCheckoutSlideover,
  shouldMountDesktopCheckoutSidebar,
  shouldMountMobileCheckoutOverlay,
  shouldShowMinimizedCheckoutFab,
} from "../lib/posCheckoutMount";
import { PosCompactCheckoutSlideover } from "../components/pos/PosCompactCheckoutSlideover";
import { PosMinimizedCheckoutFab } from "../components/pos/PosMinimizedCheckoutFab";
import { DiscountLineModal } from "../components/pos/DiscountLineModal";
import { ShiftCloseModal } from "../components/pos/ShiftCloseModal";
import { ShiftSellGateway } from "../components/pos/ShiftSellGateway";
import { ActiveShiftBanner } from "../components/pos/ActiveShiftBanner";
import { PosShiftSummaryCollapsible } from "../components/pos/PosShiftSummaryCollapsible";
import { PosQuickProductChips } from "../components/pos/PosQuickProductChips";
import { PosDesktopCatalogCheckoutDock } from "../components/pos/PosDesktopCatalogCheckoutDock";
import {
  applyCheckoutAlphaKey,
  applyCheckoutNumericKey,
  applyCheckoutPhoneKey,
  preferredKeypadModeForField,
  type CheckoutInputField,
  type CheckoutKeypadMode,
} from "../lib/posCheckoutKeypad";
import { PosDesktopCompactHeader } from "../components/pos/PosDesktopCompactHeader";
import { EmptyShelfPanel } from "../components/stock/EmptyShelfPanel";
import { PosDesktopProductCard } from "../components/pos/PosDesktopProductCard";
import { PosDesktopStatusBar } from "../components/pos/PosDesktopStatusBar";
import { PosSellProductCard } from "../components/pos/PosSellProductCard";
import { PosSellCatalogShelfSection } from "../components/pos/PosSellCatalogShelfSection";
import { PosExitConfirmModal } from "../components/pos/PosExitConfirmModal";
import { registerPosExitHandler } from "../lib/posExitGuard";
import { lineDiscountUgx } from "../lib/saleAdjustments";
import { PosPageScrollSpacer } from "../components/layout/posScrollSpacer";
import { PosScreenPortal } from "../components/layout/PosScreenPortal";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { combinedBottomInsetStyle } from "../lib/safeAreaInsets";
import { ProductLockedModal } from "../components/ProductLockedModal";
import { isProductPlanLocked, lockedProductIds } from "../lib/productPlanLock";
import { hapticSaleComplete, hapticTap, playSaleSuccessTone } from "../lib/nativeFeedback";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { maxProductsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { gateDraftSaleStockBeforeFinalize } from "../lib/preFinalizeStockGate";
import { scanTodaySalesHead } from "../lib/salesDayIndex";
import { pendingSales } from "../lib/saleStatus";
import { useDeferredSales } from "../hooks/useDeferredSales";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
  productMatchesCategoryFilter,
  shelfIconFor,
} from "../lib/productCategories";
import {
  buildProductSellSearchIndex,
  filterIndexedProductsForSellView,
  filterProductsByCategoryOnly,
  productMatchesIndexedSellSearch,
} from "../lib/posProductSearch";
import { formatStockLabel, getPosSellPresets } from "../lib/sellingEngine";
import {
  baseUnitsForSaleUnit,
  detectPharmacySaleUnit,
  formatPharmacyStockPrimary,
  isPharmacyPackagingActive,
} from "../lib/pharmacyPackaging";
import { computeDraftCartStats, computeDraftCheckoutTotals, draftLineQuantityStep, formatDraftLineQty } from "../lib/draftCart";
import { CartSaleDiscountModal } from "../components/pos/CartSaleDiscountModal";
import { QuantityEditModal } from "../components/pos/QuantityEditModal";
import { brandingFromSale } from "../lib/receiptBranding";
import { canRecordCashExpenses } from "../lib/cashExpenses";
import { RecordExpenseModal } from "../components/pos/RecordExpenseModal";
import { isPharmacyMode } from "../lib/pharmacy";
import { gateExpiredMedicineSale } from "../lib/pharmacySaleGuard";
import { findProductByBarcode } from "../lib/pharmacyMedicine";
import { PharmacyFefoBatchPicker } from "../components/pharmacy/PharmacyFefoBatchPicker";
import { PharmacyControlledDispenseGate } from "../components/pharmacy/compliance/PharmacyControlledDispenseGate";
import { usePharmacyControlledCheckout } from "../hooks/usePharmacyControlledCheckout";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isHospitalityMode } from "../lib/hospitality";
import { isWholesaleMode } from "../lib/wholesale";
import { useWholesaleTerms } from "../lib/wholesaleTerms";
import { useDisplayScale } from "../context/DisplayScaleProvider";
import { DISPLAY_SCALE_META } from "../lib/displayScale/scaleTokens";
import {
  detectBarcodeCapabilities,
  startBarcodeSession,
  stopBarcodeSession,
} from "../services/hardware/barcodeAdapter";

const VIRTUAL_PRODUCT_THRESHOLD = 10;
const MAX_RECENT_SEARCHES = 4;
const MAX_RECENT_PRODUCTS = 14;
const MAX_FAVORITE_PRODUCTS = 20;

import {
  buildReceiptDisplayData,
  buildReceiptNumberForSale,
  buildSaleReceiptHtml,
  buildSaleReceiptText,
} from "../lib/receiptPrint";
import { logReceiptPdfExportAudit, logReceiptReprintAudit } from "../lib/auditReceiptLog";
import { downloadSaleReceiptPdf, printSaleReceipt, shareSaleReceiptPdf } from "../lib/receiptDocuments";
import { isNativePrintPlatform } from "../lib/nativeReceiptPrint";
import { buildSaleReceiptContext } from "../lib/receiptContextHelpers";
import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";
import { posSearchAliases } from "../lib/pharmacyUx";
import { usePosAndroidBackStack } from "../hooks/usePosAndroidBackStack";
import { PosOfflineBanner } from "../components/trust/PosOfflineBanner";
import { registerPosLeaveGuard } from "../lib/posLeaveGuard";
import {
  buildPosShelfDisplayCards,
  buildQuickSellShelfCard,
  QUICK_SELL_SHELF_KEY,
  shelfMasonryGridClass,
} from "../lib/posShelfLayout";
import { PosShelfTile } from "../components/pos/PosShelfTile";

type PaymentMethod = "cash" | "atm" | "mobile_money" | "mixed" | "credit";

const POS_CHECKOUT_METHODS: PaymentMethod[] = ["cash", "atm", "mobile_money", "credit"];

const EMPTY_SHELF_LAYOUT: Record<string, PosShelfLayoutConfig> = {};
const EMPTY_QUICK_SELL_IDS: string[] = [];

const Numpad = memo(function Numpad({
  onDigit,
  onClear,
  allowDecimal,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  allowDecimal: boolean;
}) {
  const row4 = allowDecimal ? [".", "0", "⌫"] : ["0", "⌫", "C"];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onDigit(k)}
            className="min-h-[56px] rounded-2xl bg-muted py-3 text-2xl font-semibold text-foreground active:bg-muted active:brightness-95 motion-reduce:active:brightness-100"
          >
            {k}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {row4.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (k === "C") onClear();
              else if (k === "⌫") onDigit("back");
              else onDigit(k);
            }}
            className="min-h-[56px] rounded-2xl bg-muted py-3 text-2xl font-semibold text-foreground active:bg-muted active:brightness-95"
          >
            {k}
          </button>
        ))}
      </div>
      {allowDecimal && (
        <button
          type="button"
          onClick={onClear}
          className="w-full min-h-[52px] rounded-2xl bg-amber-100 py-3 text-lg font-bold text-amber-900 active:bg-amber-200"
        >
          C
        </button>
      )}
    </div>
  );
});

function parseDisplayMoney(s: string): number {
  const n = Number(s.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDisplayQty(s: string): number {
  const cleaned = s.replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function PosPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canSavePending = actorHasPermission(actor, "pending_sales.manage");
  const canIssueDebt = actorHasPermission(actor, "customers.debt");
  const checkoutMethods = useMemo(
    () => POS_CHECKOUT_METHODS.filter((m) => m !== "credit" || canIssueDebt),
    [canIssueDebt],
  );
  const shopPreferences = usePosStore((s) => s.preferences);
  const pt = usePharmacyTerms(lang, shopPreferences.businessType, shopPreferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, shopPreferences.businessType, shopPreferences.hospitalityModeEnabled);
  const wt = useWholesaleTerms(lang, shopPreferences.businessType);
  const pharmacyMode = isPharmacyMode(shopPreferences.businessType, shopPreferences.pharmacyModeEnabled);
  const hospitalityMode = isHospitalityMode(shopPreferences.businessType, shopPreferences.hospitalityModeEnabled);
  const wholesaleMode = isWholesaleMode(shopPreferences.businessType);
  const modeTerm = hospitalityMode ? ht : wholesaleMode ? wt : pt;
  const sellNavLabelKey = hospitalityMode
    ? "navSell"
    : pharmacyMode
      ? "navDispense"
      : wholesaleMode
        ? "navInvoiceDesk"
        : "navSell";
  const { snapshot, authMode } = useSubscription();
  const receiptPlanTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const location = useLocation();
  const navigate = useNavigate();
  const products = usePosStore(useShallow((s) => s.products));
  const sales = useDeferredSales();
  const pendingCount = useMemo(() => pendingSales(sales).length, [sales]);
  const todaySalesSummary = useMemo(
    () =>
      summarizeTodaySales(
        sales,
        new Date(),
        actor.role === "cashier" ? { soldByUserId: actor.userId } : undefined,
      ),
    [sales, actor.role, actor.userId],
  );
  const customers = usePosStore(useShallow((s) => s.customers));
  const preferences = usePosStore(
    useShallow((s) => ({
      kioskQuickSell: s.preferences.kioskQuickSell,
      hapticsOn: s.preferences.hapticsOn,
      saleSoundOn: s.preferences.saleSoundOn,
      shifts: s.preferences.shifts,
      posLocked: s.preferences.posLocked,
      posSellCategoryFilter: s.preferences.posSellCategoryFilter,
      posPinnedShelfKeys: s.preferences.posPinnedShelfKeys,
      posShelfLayout: s.preferences.posShelfLayout,
      posShelfDefaultScale: s.preferences.posShelfDefaultScale,
      posQuickSellProductIds: s.preferences.posQuickSellProductIds,
      favoriteProductIds: s.preferences.favoriteProductIds,
      recentProductIds: s.preferences.recentProductIds,
      staffAccounts: s.preferences.staffAccounts,
      shopDisplayName: s.preferences.shopDisplayName,
      shopAddressLine: s.preferences.shopAddressLine,
      shopPhoneE164: s.preferences.shopPhoneE164,
      celebratedFirstSale: s.preferences.celebratedFirstSale,
      receiptPaperSize: s.preferences.receiptPaperSize,
    })),
  );
  const draftLines = usePosStore((s) => s.draftLines);
  const activePharmacyPrescriptionId = usePosStore((s) => s.activePharmacyPrescriptionId);
  const pharmacyPrescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const selectedPharmacyRx = useMemo(
    () =>
      activePharmacyPrescriptionId
        ? pharmacyPrescriptions.find((r) => r.id === activePharmacyPrescriptionId) ?? null
        : null,
    [activePharmacyPrescriptionId, pharmacyPrescriptions],
  );
  const controlledCheckout = usePharmacyControlledCheckout(pharmacyMode ? selectedPharmacyRx : null);
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const removeDraftLine = usePosStore((s) => s.removeDraftLine);
  const setDraftLineQuantity = usePosStore((s) => s.setDraftLineQuantity);
  const setDraftLineBatchOverride = usePosStore((s) => s.setDraftLineBatchOverride);
  const adjustDraftLineQuantity = usePosStore((s) => s.adjustDraftLineQuantity);
  const applyDraftLineDiscount = usePosStore((s) => s.applyDraftLineDiscount);
  const draftCartDiscountUgx = usePosStore((s) => s.draftCartDiscountUgx);
  const setDraftCartDiscount = usePosStore((s) => s.setDraftCartDiscount);
  const closeShiftWithCashCount = usePosStore((s) => s.closeShiftWithCashCount);
  const clearDraft = usePosStore((s) => s.clearDraft);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);
  const savePendingSale = usePosStore((s) => s.savePendingSale);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const quickSell = preferences.kioskQuickSell;

  const runWithExpiredGuard = useCallback(
    (product: Product, run: () => void) => {
      const prefs = usePosStore.getState().preferences;
      const gate = gateExpiredMedicineSale(
        product,
        prefs.pharmacyExpiredSaleBehavior ?? "warn",
        isPharmacyMode(prefs.businessType, prefs.pharmacyModeEnabled),
      );
      if (gate.action === "proceed") {
        run();
        return;
      }
      if (gate.action === "block") {
        const msg = t(lang, "pharmacyExpiredSaleBlocked");
        setCheckoutBlockMessage(msg);
        setToast(msg);
        window.setTimeout(() => setToast(null), 3200);
        return;
      }
      pendingExpiredAddRef.current = run;
      setExpiryWarnProduct(product);
    },
    [lang],
  );

  const currentTier = resolveEffectivePlanTier(snapshot);
  const productLimit = maxProductsForTier(currentTier);
  const lockedIds = useMemo(() => lockedProductIds(products, productLimit), [products, productLimit]);
  const unlockedProducts = useMemo(
    () => (productLimit === null ? products : products.slice(0, productLimit)),
    [products, productLimit],
  );
  const lockedProductCount = lockedIds.size;
  const [productLockedOpen, setProductLockedOpen] = useState(false);
  const hapticsOn = preferences.hapticsOn !== false;
  const soundOn = preferences.saleSoundOn !== false;

  const [sheetOpen, setSheetOpen] = useState(false);
  /** When true, checkout is a slim bar so the user can scroll the product list again. */
  const [saleCheckoutMinimized, setSaleCheckoutMinimized] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [pharmacySellUnit, setPharmacySellUnit] = useState<PharmacySaleUnitType>("tablet");
  const [inputMode, setInputMode] = useState<LineInputMode>("money");
  const [display, setDisplay] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const pharmacyPackActive = selected ? isPharmacyPackagingActive(selected) : false;
  const pharmacySellUnits = useMemo((): PharmacySaleUnitType[] => {
    const pkg = selected?.pharmacyPackaging;
    if (!pkg?.enabled) return [];
    const units: PharmacySaleUnitType[] = [];
    if (pkg.sell.tablet !== false) units.push("tablet");
    if (pkg.sell.strip && pkg.level1) units.push("strip");
    if (pkg.sell.box && pkg.level2) units.push("box");
    return units;
  }, [selected]);

  useEffect(() => {
    if (!selected || !pharmacyPackActive) return;
    const pkg = selected.pharmacyPackaging!;
    if (pkg.level2 && pkg.sell.box) setPharmacySellUnit("box");
    else if (pkg.level1 && pkg.sell.strip) setPharmacySellUnit("strip");
    else setPharmacySellUnit("tablet");
    setInputMode("quantity");
    setShowAdvanced(true);
  }, [selected?.id, pharmacyPackActive]);

  const draftCartStats = useMemo(() => computeDraftCartStats(draftLines), [draftLines]);
  const checkoutTotals = useMemo(
    () => computeDraftCheckoutTotals(draftLines, draftCartDiscountUgx),
    [draftLines, draftCartDiscountUgx],
  );
  const draftPayable = checkoutTotals.payableUgx;
  const draftDiscountTotal = useMemo(() => draftLines.reduce((a, l) => a + lineDiscountUgx(l), 0), [draftLines]);
  const [qtyEditLine, setQtyEditLine] = useState<SaleLine | null>(null);
  const [batchPickerLine, setBatchPickerLine] = useState<SaleLine | null>(null);
  const [cartSaleDiscountOpen, setCartSaleDiscountOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const customerSelectRef = useRef<HTMLSelectElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const checkoutPanelRef = useRef<HTMLDivElement>(null);
  const posLayoutMode = usePosLayoutMode();
  const posViewportWidth = usePosViewportWidth();
  const { level: displayScaleLevel, featureEnabled: displayScaleOn, stepUp: displayScaleUp, stepDown: displayScaleDown } =
    useDisplayScale();
  const displayScaleMultiplier = DISPLAY_SCALE_META[displayScaleLevel].multiplier;
  const isFullDesktopPos = posLayoutMode === "full";
  const mountDesktopCheckoutSidebar = shouldMountDesktopCheckoutSidebar(
    posLayoutMode,
    products.length > 0,
    draftLines.length,
    saleCheckoutMinimized,
  );
  const useDesktopCatalogCheckoutDock = isFullDesktopPos && mountDesktopCheckoutSidebar;
  const posSplitColumns =
    mountDesktopCheckoutSidebar && isFullDesktopPos
      ? posSplitGridTemplateColumns(posViewportWidth, displayScaleMultiplier)
      : null;
  const { columnCount: productGridCols } = useCatalogContainerWidth(catalogRef, displayScaleLevel);
  const activeShift = useMemo(
    () => (preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId) ?? null,
    [preferences.shifts, actor.userId],
  );
  const [discountLine, setDiscountLine] = useState<SaleLine | null>(null);
  const [shiftCloseOpen, setShiftCloseOpen] = useState(false);
  const [posExitOpen, setPosExitOpen] = useState(false);
  const posExitResolverRef = useRef<((choice: "lock" | "continue" | "cancel") => void) | null>(null);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  useEffect(() => {
    if (paymentMethod === "credit" && !canIssueDebt) setPaymentMethod("cash");
  }, [paymentMethod, canIssueDebt]);

  useEffect(() => {
    if (!displayScaleOn) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        displayScaleUp();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        displayScaleDown();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (e.deltaY < 0) displayScaleUp();
      else displayScaleDown();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [displayScaleOn, displayScaleUp, displayScaleDown]);
  const [cashInput, setCashInput] = useState("");
  const [mobileMoneyInput, setMobileMoneyInput] = useState("");
  const [checkoutAmountField, setCheckoutAmountField] = useState<CheckoutInputField>("cash");
  const [checkoutKeypadMode, setCheckoutKeypadMode] = useState<CheckoutKeypadMode>("numeric");
  const [saleCustomerId, setSaleCustomerId] = useState<string>("");
  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [saleCustomerPhone, setSaleCustomerPhone] = useState("");
  const selectedPatientForGate = useMemo(() => {
    if (!saleCustomerId) return saleCustomerName.trim() || null;
    return customers.find((c) => c.id === saleCustomerId)?.name ?? (saleCustomerName.trim() || null);
  }, [saleCustomerId, customers, saleCustomerName]);
  const [toast, setToast] = useState<string | null>(null);
  const [checkoutBlockMessage, setCheckoutBlockMessage] = useState<string | null>(null);
  const [checkoutBlockModalOpen, setCheckoutBlockModalOpen] = useState(false);
  const [expiryWarnProduct, setExpiryWarnProduct] = useState<Product | null>(null);
  const pendingExpiredAddRef = useRef<(() => void) | null>(null);
  const [firstSaleOpen, setFirstSaleOpen] = useState(false);
  const pendingReceiptSaleIdRef = useRef<string | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const [saleSuccessFlash, setSaleSuccessFlash] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogNumpadOpen, setCatalogNumpadOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [cameraScanOpen, setCameraScanOpen] = useState(false);
  const [cameraScanStatus, setCameraScanStatus] = useState("");
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);

  const sellCategoryKey = preferences.posSellCategoryFilter ?? CATEGORY_FILTER_ALL;
  const shelfOrderKeys = preferences.posPinnedShelfKeys ?? [];
  const shelfLayout = preferences.posShelfLayout ?? EMPTY_SHELF_LAYOUT;
  const shelfDefaultScale = preferences.posShelfDefaultScale ?? 35;
  const quickSellProductIds = preferences.posQuickSellProductIds ?? EMPTY_QUICK_SELL_IDS;
  const soldTodayByProduct = useMemo(() => scanTodaySalesHead(sales).unitsByProduct, [sales]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p] as const)), [products]);
  const favoriteIdSet = useMemo(() => new Set(preferences.favoriteProductIds ?? []), [preferences.favoriteProductIds]);

  const favoriteIds = preferences.favoriteProductIds ?? [];
  const recentIds = preferences.recentProductIds ?? [];
  const unlockedProductIds = useMemo(() => new Set(unlockedProducts.map((p) => p.id)), [unlockedProducts]);

  useEffect(() => {
    for (const line of draftLines) {
      if (!unlockedProductIds.has(line.productId)) removeDraftLine(line.productId);
    }
  }, [draftLines, removeDraftLine, unlockedProductIds]);

  const favoriteProducts = useMemo(
    () =>
      favoriteIds
        .map((id) => productById.get(id))
        .filter((p): p is Product => p != null && productMatchesCategoryFilter(p, sellCategoryKey)),
    [favoriteIds, productById, sellCategoryKey],
  );

  const recentProducts = useMemo(() => {
    const out: Product[] = [];
    for (const id of recentIds) {
      const p = productById.get(id);
      if (p && productMatchesCategoryFilter(p, sellCategoryKey)) out.push(p);
    }
    return out.slice(0, 8);
  }, [recentIds, productById, sellCategoryKey]);

  const bumpRecentProduct = useCallback(
    (productId: string) => {
      const cur = usePosStore.getState().preferences.recentProductIds ?? [];
      const next = [productId, ...cur.filter((x) => x !== productId)].slice(0, MAX_RECENT_PRODUCTS);
      setPreferences({ recentProductIds: next });
    },
    [setPreferences],
  );

  const toggleFavoriteProduct = useCallback(
    (productId: string) => {
      const cur = usePosStore.getState().preferences.favoriteProductIds ?? [];
      const next = (cur.includes(productId) ? cur.filter((x) => x !== productId) : [...cur, productId]).slice(
        0,
        MAX_FAVORITE_PRODUCTS,
      );
      setPreferences({ favoriteProductIds: next });
    },
    [setPreferences],
  );

  const receiptSale = useMemo(() => sales.find((s) => s.id === receiptSaleId) ?? null, [sales, receiptSaleId]);

  const staffAccounts = preferences.staffAccounts ?? [];
  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffAccounts) m.set(s.id, s.name);
    return m;
  }, [staffAccounts]);

  const receiptCashierLabel = useCallback(
    (sale: { soldByUserId?: string | null }) => {
      const id = sale.soldByUserId ?? "";
      if (id.startsWith("staff:")) return staffNameById.get(id.slice("staff:".length)) ?? t(lang, "role_cashier");
      return actor.displayName ?? t(lang, "role_owner");
    },
    [actor.displayName, lang, staffNameById],
  );

  const receiptDisplay = useMemo(() => {
    if (!receiptSale) return null;
    const branding = brandingFromSale(receiptSale, shopPreferences, receiptPlanTier);
    const shopName = (preferences.shopDisplayName ?? "").trim() || "Waka POS";
    const receiptNumber = buildReceiptNumberForSale(receiptSale, sales);
    const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
    return buildReceiptDisplayData({
      shopName,
      shopAddress: preferences.shopAddressLine ?? null,
      shopPhone: preferences.shopPhoneE164 ?? null,
      headerLines: branding.headerLines,
      customHeaderLines: branding.customHeaderLines,
      footerLines: branding.footerLines,
      cashier: receiptCashierLabel(receiptSale),
      receiptNumber,
      sale: receiptSale,
      productById,
      footerThanks: branding.footerThanks,
      footerPowered: branding.footerPowered,
      returnPolicy: branding.returnPolicy,
      displayOptions: branding.displayOptions,
      customerName: receiptSale.receiptCustomerName ?? cust?.name ?? null,
      customerPhone: receiptSale.receiptCustomerPhone ?? cust?.phone ?? null,
      customerBalanceUgx: cust?.debtBalanceUgx ?? null,
    });
  }, [
    receiptSale,
    shopPreferences,
    receiptPlanTier,
    sales,
    productById,
    receiptCashierLabel,
    customers,
  ]);

  const receiptPlain = useMemo(() => {
    if (!receiptSale || !receiptDisplay) return "";
    const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
    return buildSaleReceiptText({
      shopName: receiptDisplay.shopName,
      shopAddress: receiptDisplay.shopAddress,
      shopPhone: receiptDisplay.shopPhone,
      cashier: receiptDisplay.cashier,
      receiptNumber: receiptDisplay.receiptNumber,
      sale: receiptSale,
      productById,
      paymentMethodLabel: receiptDisplay.paymentMethodLabel,
      amountPaidUgx: receiptDisplay.paidUgx,
      changeUgx: receiptDisplay.changeUgx,
      footerThanks: receiptDisplay.footerThanks,
      footerPowered: receiptDisplay.footerPowered ?? undefined,
      returnPolicy: receiptDisplay.returnPolicy,
      customerName: cust?.name ?? null,
      customerBalanceUgx: cust ? cust.debtBalanceUgx : null,
      headerLines: receiptDisplay.headerLines,
      footerLines: receiptDisplay.footerLines,
      displayOptions: receiptDisplay.displayOptions,
      customerPhone: receiptDisplay.customerPhone,
      labels: {
        cashier: t(lang, "receiptCashier"),
        items: t(lang, "receiptItemsLabel"),
        total: t(lang, "receiptTotalLabel"),
        paid: t(lang, "receiptPaidLabel"),
        debtSale: t(lang, "receiptDebtLine"),
        balance: t(lang, "receiptBalanceLine"),
        time: t(lang, "receiptTimeLabel"),
        outstandingDebt: t(lang, "receiptOutstandingDebt"),
        customer: t(lang, "receiptCustomerLabel"),
        customerNotRecorded: t(lang, "receiptCustomerNotRecorded"),
        receiptNo: t(lang, "receiptNoLabel"),
        date: t(lang, "receiptDateLabel"),
        method: t(lang, "receiptMethodLabel"),
        change: t(lang, "receiptChangeLabel"),
        subtotal: t(lang, "receiptSubtotalLabel"),
        discount: t(lang, "receiptDiscountLabel"),
        grandTotal: t(lang, "receiptGrandTotalLabel"),
      },
    });
  }, [receiptSale, receiptDisplay, customers, productById, lang]);

  const receiptHtmlPreview = useMemo(() => (receiptDisplay ? buildSaleReceiptHtml(receiptDisplay) : ""), [receiptDisplay]);

  const frequentToday = useMemo(
    () =>
      products
        .filter((p) => productMatchesCategoryFilter(p, sellCategoryKey))
        .map((p) => ({ product: p, qty: soldTodayByProduct.get(p.id) ?? 0 }))
        .filter((r) => r.qty > 0)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 6),
    [products, soldTodayByProduct, sellCategoryKey],
  );

  const setSellCategoryFilter = useCallback(
    (next: string) => {
      setPreferences({
        posSellCategoryFilter:
          next === CATEGORY_FILTER_ALL || next === "" ? undefined : next === UNCATEGORIZED_SENTINEL ? UNCATEGORIZED_SENTINEL : next,
      });
    },
    [setPreferences],
  );

  const clearSellView = useCallback(() => {
    setSellCategoryFilter(CATEGORY_FILTER_ALL);
    setSearchQuery("");
  }, [setSellCategoryFilter]);

  const sellSearchContext = useMemo(() => {
    const q = searchQuery.trim();
    const qLower = q.toLowerCase();
    const aliases = posSearchAliases(
      shopPreferences.businessType,
      shopPreferences.pharmacyModeEnabled,
      shopPreferences.hospitalityModeEnabled,
    );
    const aliasSet = new Set<string>();
    if (qLower && aliases[qLower]) {
      for (const a of aliases[qLower]) aliasSet.add(a);
    }
    for (const tok of qLower.split(/\s+/).filter(Boolean)) {
      const al = aliases[tok];
      if (al) for (const x of al) aliasSet.add(x);
    }
    return { q, aliasTerms: [...aliasSet] };
  }, [searchQuery, shopPreferences.businessType, shopPreferences.pharmacyModeEnabled]);

  const productSearchIndex = useMemo(() => buildProductSellSearchIndex(products), [products]);

  const sellRowMatchesSearch = useMemo(() => {
    const { q, aliasTerms } = sellSearchContext;
    if (!q) return () => true;
    return (p: Product) => productMatchesIndexedSellSearch(productSearchIndex, p, q, aliasTerms);
  }, [sellSearchContext, productSearchIndex]);

  const frequentTodayVisible = useMemo(
    () => frequentToday.filter(({ product }) => sellRowMatchesSearch(product)),
    [frequentToday, sellRowMatchesSearch],
  );

  const favoriteProductsVisible = useMemo(
    () => favoriteProducts.filter((p) => sellRowMatchesSearch(p)),
    [favoriteProducts, sellRowMatchesSearch],
  );

  const recentProductsVisible = useMemo(() => {
    const fav = favoriteIds;
    return recentProducts.filter((p) => sellRowMatchesSearch(p) && !fav.includes(p.id));
  }, [recentProducts, favoriteIds, sellRowMatchesSearch]);

  const filteredProducts = useMemo(() => {
    const { q, aliasTerms } = sellSearchContext;
    if (!q) {
      return filterProductsByCategoryOnly(products, sellCategoryKey, favoriteIdSet);
    }
    return filterIndexedProductsForSellView(productSearchIndex, sellCategoryKey, q, aliasTerms, favoriteIdSet);
  }, [products, productSearchIndex, sellSearchContext, sellCategoryKey, favoriteIdSet]);

  const shelfCards = useMemo(() => {
    return buildPosShelfDisplayCards(
      products,
      t(lang, "posNoShelf"),
      shelfLayout,
      shelfOrderKeys,
      shelfDefaultScale,
    );
  }, [products, lang, shelfLayout, shelfOrderKeys, shelfDefaultScale]);

  const quickSellProducts = useMemo(
    () =>
      quickSellProductIds
        .map((id) => productById.get(id))
        .filter((p): p is Product => p != null && !isProductPlanLocked(p.id, lockedIds)),
    [quickSellProductIds, productById, lockedIds],
  );

  const quickSellShelf = useMemo(
    () =>
      buildQuickSellShelfCard(
        quickSellProductIds,
        products,
        t(lang, "posQuickSellShelf"),
        shelfLayout[QUICK_SELL_SHELF_KEY],
        shelfDefaultScale,
      ),
    [quickSellProductIds, products, lang, shelfLayout, shelfDefaultScale],
  );

  const showShelfBoxes =
    products.length > 0 &&
    sellCategoryKey === CATEGORY_FILTER_ALL &&
    sellSearchContext.q.length === 0 &&
    !isFullDesktopPos;
  const hasSellViewFilter = sellCategoryKey !== CATEGORY_FILTER_ALL || sellSearchContext.q.length > 0;

  const selectedShelfLabel =
    sellCategoryKey === UNCATEGORIZED_SENTINEL
      ? t(lang, "posNoShelf")
      : sellCategoryKey === CATEGORY_FILTER_ALL
        ? t(lang, "posCategoryAll")
        : sellCategoryKey;

  const openProduct = useCallback(
    (p: Product) => {
      if (isProductPlanLocked(p.id, lockedIds)) {
        setProductLockedOpen(true);
        return;
      }
      const moneyPresetsForProduct = p.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
      const qtyPresetsForProduct = p.quickPresetsQty?.filter((x) => x > 0) ?? [];
      const pref = usePosStore.getState().preferences;
      const singleQuickPreset =
        pref.kioskQuickSell && moneyPresetsForProduct.length + qtyPresetsForProduct.length === 1;

      if (singleQuickPreset) {
        const mode: LineInputMode = moneyPresetsForProduct.length === 1 ? "money" : "quantity";
        const value = moneyPresetsForProduct[0] ?? qtyPresetsForProduct[0] ?? 0;
        runWithExpiredGuard(p, () => {
          setDraftInput({ product: p, inputMode: mode, value });
          const res = addDraftLineFromInput();
          if (!res.ok) {
            setToast(t(lang, res.errorKey ?? "saleError"));
            window.setTimeout(() => setToast(null), 2200);
            return;
          }
          bumpRecentProduct(p.id);
          if (hapticsOn) void hapticTap();
          if (posLayoutMode !== "full") setSaleCheckoutMinimized(true);
          setToast(t(lang, "posAddedToCart"));
          window.setTimeout(() => setToast(null), 1200);
          searchInputRef.current?.focus();
        });
        return;
      }

      setSelected(p);
      setInputMode("money");
      setDisplay("");
      const hasPresets = moneyPresetsForProduct.length > 0 || qtyPresetsForProduct.length > 0;
      setShowAdvanced(!pref.kioskQuickSell || !hasPresets);
      setDraftInput(null);
      setSheetOpen(true);
    },
    [addDraftLineFromInput, bumpRecentProduct, hapticsOn, posLayoutMode, lang, lockedIds, runWithExpiredGuard, setDraftInput],
  );

  const fastAddFromScan = useCallback(
    (p: Product) => {
      const fast = resolveScanToCartInput(p);
      if (!fast) return false;
      runWithExpiredGuard(p, () => {
        setDraftInput({ product: p, inputMode: fast.inputMode, value: fast.value });
        const res = addDraftLineFromInput();
        if (!res.ok) {
          setToast(t(lang, res.errorKey ?? "saleError"));
          window.setTimeout(() => setToast(null), 2200);
          return;
        }
        bumpRecentProduct(p.id);
        if (hapticsOn) void hapticTap();
        if (posLayoutMode !== "full") setSaleCheckoutMinimized(true);
        setToast(t(lang, "posScanAdded"));
        window.setTimeout(() => setToast(null), 1200);
        searchInputRef.current?.blur();
      });
      return true;
    },
    [addDraftLineFromInput, bumpRecentProduct, hapticsOn, posLayoutMode, lang, runWithExpiredGuard, setDraftInput],
  );

  const handleBarcodeProduct = useCallback(
    (p: Product) => {
      if (isProductPlanLocked(p.id, lockedIds)) {
        setProductLockedOpen(true);
        return;
      }
      if (fastAddFromScan(p)) return;
      openProduct(p);
    },
    [fastAddFromScan, lockedIds, openProduct],
  );

  const quickTapAddProduct = useCallback(
    (p: Product) => {
      if (isProductPlanLocked(p.id, lockedIds)) {
        setProductLockedOpen(true);
        return;
      }
      if (fastAddFromScan(p)) return;
      openProduct(p);
    },
    [fastAddFromScan, lockedIds, openProduct],
  );

  useEffect(() => {
    const caps = detectBarcodeCapabilities();
    if (!caps.hidWedge) return;
    void startBarcodeSession("hid", {
      onScan: (code) => {
        setSearchQuery(code);
        const exact = findProductByBarcode(products, code);
        if (exact) {
          handleBarcodeProduct(exact);
        } else {
          setToast(t(lang, "posBarcodeNotFound"));
          window.setTimeout(() => setToast(null), 2200);
          searchInputRef.current?.blur();
        }
      },
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [products, handleBarcodeProduct, lang]);

  useEffect(() => {
    if (!cameraScanOpen) return;
    setCameraScanStatus("Starting camera scanner...");
    void startBarcodeSession("camera", {
      videoElement: cameraVideoRef.current,
      onScan: (code) => {
        setSearchQuery(code);
        setCameraScanStatus(`Scanned: ${code}`);
        const exact = findProductByBarcode(products, code);
        if (exact) {
          handleBarcodeProduct(exact);
        } else {
          setToast(t(lang, "posBarcodeNotFound"));
          window.setTimeout(() => setToast(null), 2200);
        }
        void stopBarcodeSession();
        setCameraScanOpen(false);
      },
      onError: (message) => setCameraScanStatus(message),
    }).then((result) => {
      if (!result.ok) setCameraScanStatus(result.error ?? t(lang, "posBarcodeSoon"));
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [cameraScanOpen, handleBarcodeProduct, lang, products]);

  useEffect(() => {
    if (draftLines.length === 0) setSaleCheckoutMinimized(false);
  }, [draftLines.length]);

  useEffect(() => {
    const id = (location.state as { preferProductId?: string } | null)?.preferProductId;
    if (!id || !products.length) return;
    const p = productById.get(id);
    if (!p) return;
    openProduct(p);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.key, location.pathname, products.length, productById, openProduct, navigate]);

  useEffect(() => {
    if (!sheetOpen || !selected) return;
    const hasPresets =
      (selected.quickPresetsMoneyUgx?.filter((x) => x > 0).length ?? 0) > 0 ||
      ((selected.quickPresetsQty?.filter((x) => x > 0).length ?? 0) > 0);
    if (preferences.kioskQuickSell && !hasPresets) setShowAdvanced(true);
  }, [sheetOpen, selected, preferences.kioskQuickSell]);

  const appendDigit = useCallback(
    (d: string) => {
      if (d === "back") {
        setDisplay((x) => x.slice(0, -1));
        return;
      }
      if (inputMode === "money") {
        setDisplay((x) => (x + d).replace(/^0+(\d)/, "$1").slice(0, 9));
      } else {
        if (d === ".") {
          setDisplay((x) => (x.includes(".") ? x : x.length ? `${x}.` : "0."));
          return;
        }
        setDisplay((x) => {
          const next = x + d;
          if (next.includes(".") && (next.split(".")[1]?.length ?? 0) > 4) return x;
          return next.length > 12 ? x : next;
        });
      }
    },
    [inputMode],
  );

  const afterAddToCart = useCallback(
    (productId: string, opts?: { closeSheet?: boolean }) => {
      bumpRecentProduct(productId);
      if (hapticsOn) void hapticTap();
      setDisplay("");
      setDraftInput(null);
      if (posLayoutMode !== "full") setSaleCheckoutMinimized(true);
      if (opts?.closeSheet !== false) {
        setSheetOpen(false);
        setSelected(null);
      }
      setToast(t(lang, "posAddedToCart"));
      window.setTimeout(() => setToast(null), 1200);
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    },
    [bumpRecentProduct, hapticsOn, posLayoutMode, setDraftInput, lang],
  );

  const applyDraftInput = useCallback(() => {
    if (!selected) return;
    const val = inputMode === "money" ? parseDisplayMoney(display) : parseDisplayQty(display);
    runWithExpiredGuard(selected, () => {
      setDraftInput({
        product: selected,
        inputMode,
        value: val,
        ...(pharmacyPackActive && inputMode === "quantity" ? { pharmacySaleUnit: pharmacySellUnit } : {}),
      });
      const res = addDraftLineFromInput();
      if (!res.ok) {
        setToast(t(lang, res.errorKey ?? "saleError"));
        window.setTimeout(() => setToast(null), 2200);
        return;
      }
      afterAddToCart(selected.id);
    });
  }, [selected, inputMode, display, pharmacyPackActive, pharmacySellUnit, setDraftInput, addDraftLineFromInput, lang, afterAddToCart, runWithExpiredGuard]);

  const applyPreset = useCallback(
    (mode: LineInputMode, value: number) => {
      if (!selected) return;
      runWithExpiredGuard(selected, () => {
        if (pharmacyPackActive && mode === "quantity" && selected.pharmacyPackaging) {
          const unit = detectPharmacySaleUnit(selected, value);
          const per = baseUnitsForSaleUnit(selected.pharmacyPackaging, unit);
          const qtyInUnit = per > 0 ? value / per : value;
          setDraftInput({ product: selected, inputMode: mode, value: qtyInUnit, pharmacySaleUnit: unit });
        } else {
          setDraftInput({ product: selected, inputMode: mode, value });
        }
        const res = addDraftLineFromInput();
        if (!res.ok) {
          setToast(t(lang, res.errorKey ?? "saleError"));
          window.setTimeout(() => setToast(null), 2200);
          return;
        }
        afterAddToCart(selected.id);
      });
    },
    [selected, pharmacyPackActive, setDraftInput, addDraftLineFromInput, lang, afterAddToCart, runWithExpiredGuard],
  );

  const handleDraftQtyStep = useCallback(
    (line: SaleLine, backwards: boolean) => {
      const product = productById.get(line.productId);
      const delta = product ? draftLineQuantityStep(product, backwards) : backwards ? -1 : 1;
      const res = adjustDraftLineQuantity(line.productId, delta);
      if (!res.ok) {
        setToast(t(lang, res.errorKey ?? "saleError"));
        window.setTimeout(() => setToast(null), 2200);
      } else if (hapticsOn) void hapticTap();
    },
    [productById, adjustDraftLineQuantity, lang, hapticsOn],
  );

  const handleDraftQtyConfirm = useCallback(
    (productId: string, quantity: number) => {
      const res = setDraftLineQuantity(productId, quantity);
      if (!res.ok) {
        setToast(t(lang, res.errorKey ?? "saleError"));
        window.setTimeout(() => setToast(null), 2200);
      } else if (hapticsOn) void hapticTap();
    },
    [setDraftLineQuantity, lang, hapticsOn],
  );

  const totalPaidInput = useMemo(() => {
    const cash = parseDisplayMoney(cashInput);
    const mobile = parseDisplayMoney(mobileMoneyInput);
    if (paymentMethod === "cash") return cash > 0 ? cash : draftPayable;
    if (paymentMethod === "atm" || paymentMethod === "mobile_money") return draftPayable;
    if (paymentMethod === "credit") return cash + mobile;
    return cash + mobile;
  }, [paymentMethod, cashInput, mobileMoneyInput, draftPayable]);

  const changeDue = useMemo(() => {
    if (paymentMethod === "mobile_money" || paymentMethod === "atm") return 0;
    return Math.max(0, totalPaidInput - draftPayable);
  }, [paymentMethod, totalPaidInput, draftPayable]);

  const computedDebt = useMemo(() => {
    if (paymentMethod === "cash" || paymentMethod === "mobile_money" || paymentMethod === "atm") return 0;
    return Math.max(0, draftPayable - totalPaidInput);
  }, [paymentMethod, draftPayable, totalPaidInput]);

  const handleCheckoutInputField = useCallback((field: CheckoutInputField) => {
    setCheckoutAmountField(field);
    setCheckoutKeypadMode(preferredKeypadModeForField(field));
  }, []);

  const appendCheckoutDigit = useCallback(
    (d: string) => {
      if (checkoutKeypadMode === "alpha" && checkoutAmountField === "customerName") {
        setSaleCustomerName((prev) => applyCheckoutAlphaKey(prev, d));
        return;
      }
      const applyNumeric = (prev: string) => applyCheckoutNumericKey(prev, d);
      const applyPhone = (prev: string) => applyCheckoutPhoneKey(prev, d);
      switch (checkoutAmountField) {
        case "mobile":
          setMobileMoneyInput(applyPhone);
          break;
        case "customerPhone":
          setSaleCustomerPhone(applyPhone);
          break;
        case "customerName":
          setSaleCustomerName((prev) => applyCheckoutAlphaKey(prev, d));
          break;
        default:
          setCashInput(applyNumeric);
      }
    },
    [checkoutAmountField, checkoutKeypadMode],
  );

  const clearCheckoutAmount = useCallback(() => {
    switch (checkoutAmountField) {
      case "mobile":
        setMobileMoneyInput("");
        break;
      case "customerPhone":
        setSaleCustomerPhone("");
        break;
      case "customerName":
        setSaleCustomerName("");
        break;
      default:
        setCashInput("");
    }
  }, [checkoutAmountField]);

  const commitSearch = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setRecentSearches((prev) => [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES));
  }, []);

  const pendingFinalizeOptsRef = useRef<Parameters<typeof finalizeDraftSale>[0] | null>(null);

  const applyFinalizeSuccess = useCallback(
    (r: ReturnType<typeof finalizeDraftSale>) => {
      setCheckoutBlockMessage(null);
      setCheckoutBlockModalOpen(false);
      if (hapticsOn) void hapticSaleComplete();
      if (soundOn) playSaleSuccessTone();

      setCashInput("");
      setMobileMoneyInput("");
      setSaleCustomerId("");
      setSaleCustomerName("");
      setSaleCustomerPhone("");
      setCheckoutAmountField("cash");
      setCheckoutKeypadMode("numeric");
      setPaymentMethod("cash");
      if (r.saleId) {
        if (r.firstSale && !preferences.celebratedFirstSale) {
          pendingReceiptSaleIdRef.current = r.saleId;
          setFirstSaleOpen(true);
        } else {
          setReceiptSaleId(r.saleId);
        }
      }
      if (r.firstSale && !preferences.celebratedFirstSale) {
        /* receipt opens after celebration */
      } else {
        setSaleSuccessFlash(true);
        window.setTimeout(() => setSaleSuccessFlash(false), 720);
        setToast(hospitalityMode ? ht("saleSaved") : t(lang, "saleSaved"));
        window.setTimeout(() => setToast(null), 1600);
      }
    },
    [hapticsOn, soundOn, preferences.celebratedFirstSale, hospitalityMode, ht, lang],
  );

  const onControlledGateApproved = useCallback(() => {
    const opts = pendingFinalizeOptsRef.current;
    controlledCheckout.setGateOpen(false);
    if (!opts) return;
    const r = controlledCheckout.runFinalize(opts);
    pendingFinalizeOptsRef.current = null;
    if (!r.ok) {
      const msg = t(lang, r.errorKey ?? "saleError");
      if (r.errorKey === "pharmacyExpiredSaleBlocked") {
        setCheckoutBlockMessage(msg);
        setCheckoutBlockModalOpen(true);
      }
      setToast(msg);
      window.setTimeout(() => setToast(null), 3200);
      return;
    }
    applyFinalizeSuccess(r);
  }, [controlledCheckout, lang, applyFinalizeSuccess]);

  const finishSale = useCallback(() => {
    void (async () => {
    if (paymentMethod === "cash" && parseDisplayMoney(cashInput) > 0 && parseDisplayMoney(cashInput) < draftPayable) {
      setToast(t(lang, "paymentCashTooLow"));
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    const debt = paymentMethod === "credit" || paymentMethod === "mixed" ? computedDebt : 0;
    const customerId = saleCustomerId || null;
    const customerName = saleCustomerName.trim();
    if (debt > 0 && !customerId && !customerName) {
      setToast(t(lang, "debtRequiresCustomerName"));
      window.setTimeout(() => setToast(null), 3200);
      return;
    }
    const stockGate = await gateDraftSaleStockBeforeFinalize(shopPreferences, draftLines);
    if (!stockGate.ok) {
      setToast(t(lang, stockGate.errorKey));
      window.setTimeout(() => setToast(null), 3200);
      return;
    }
    if (stockGate.stockWasStale) {
      setToast(t(lang, "staleStockSyncRecommended"));
      window.setTimeout(() => setToast(null), 2800);
    }
    const finalizeOpts = {
      debtUgx: debt,
      customerId,
      customerName: customerName || null,
      customerPhone: saleCustomerPhone.trim() || null,
      paymentMethod,
      amountPaidUgx: totalPaidInput,
      changeGivenUgx: changeDue,
    };
    const r = pharmacyMode
      ? controlledCheckout.attemptFinalize(finalizeOpts)
      : finalizeDraftSale(finalizeOpts);
    if (!r.ok) {
      if (pharmacyMode && r.errorKey === "pharmacyControlledApprovalRequired") {
        pendingFinalizeOptsRef.current = finalizeOpts;
        return;
      }
      const msg = t(lang, r.errorKey ?? "saleError");
      if (r.errorKey === "pharmacyExpiredSaleBlocked") {
        setCheckoutBlockMessage(msg);
        setCheckoutBlockModalOpen(true);
      }
      setToast(msg);
      window.setTimeout(() => setToast(null), 3200);
      return;
    }
    applyFinalizeSuccess(r);
    })();
  }, [
    paymentMethod,
    cashInput,
    draftPayable,
    computedDebt,
    saleCustomerId,
    saleCustomerName,
    saleCustomerPhone,
    totalPaidInput,
    changeDue,
    finalizeDraftSale,
    lang,
    shopPreferences,
    draftLines,
    pharmacyMode,
    controlledCheckout,
    applyFinalizeSuccess,
  ]);

  const handleSavePending = useCallback(() => {
    if (!canSavePending || draftLines.length === 0) return;
    const label = saleCustomerName.trim() || undefined;
    const res = savePendingSale(label);
    if (!res.ok) {
      setToast(t(lang, res.errorKey ?? "saleError"));
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    setSaleCheckoutMinimized(false);
    setCashInput("");
    setMobileMoneyInput("");
    setSaleCustomerId("");
    setSaleCustomerName("");
    setSaleCustomerPhone("");
    setPaymentMethod("cash");
    setToast(t(lang, "pendingSaved"));
    window.setTimeout(() => setToast(null), 1600);
  }, [canSavePending, draftLines.length, saleCustomerName, savePendingSale, lang]);

  const dismissFirstSale = useCallback(() => {
    setPreferences({ celebratedFirstSale: true });
    setFirstSaleOpen(false);
    setSaleSuccessFlash(true);
    window.setTimeout(() => setSaleSuccessFlash(false), 720);
    setToast(t(lang, "saleSaved"));
    window.setTimeout(() => setToast(null), 1600);
    const rid = pendingReceiptSaleIdRef.current;
    pendingReceiptSaleIdRef.current = null;
    if (rid) setReceiptSaleId(rid);
  }, [lang, setPreferences]);

  const closeExpiryWarn = useCallback(() => {
    pendingExpiredAddRef.current = null;
    setExpiryWarnProduct(null);
  }, []);

  const showDesktopCatalogCheckoutDock =
    useDesktopCatalogCheckoutDock && (catalogNumpadOpen || paymentMethod === "credit");
  const mountCompactCheckoutSlideover = shouldMountCompactCheckoutSlideover(
    posLayoutMode,
    draftLines.length,
    saleCheckoutMinimized,
  );
  const mountMobileCheckoutOverlay = shouldMountMobileCheckoutOverlay(
    posLayoutMode,
    draftLines.length,
    saleCheckoutMinimized,
  );
  const checkoutPanelOpen = mountMobileCheckoutOverlay || mountCompactCheckoutSlideover;
  const showMinimizedCheckoutFab = shouldShowMinimizedCheckoutFab(
    posLayoutMode,
    draftLines.length,
    saleCheckoutMinimized,
  );

  usePosAndroidBackStack({
    cameraScanOpen,
    setCameraScanOpen,
    checkoutOverlayOpen: checkoutPanelOpen,
    setSaleCheckoutMinimized,
    sheetOpen,
    setSheetOpen,
    receiptOpen: receiptSaleId !== null,
    closeReceipt: () => setReceiptSaleId(null),
    checkoutBlockModalOpen,
    setCheckoutBlockModalOpen,
    cartSaleDiscountOpen,
    setCartSaleDiscountOpen,
    discountLineOpen: discountLine !== null,
    closeDiscountLine: () => setDiscountLine(null),
    qtyEditOpen: qtyEditLine !== null,
    closeQtyEdit: () => setQtyEditLine(null),
    shiftCloseOpen,
    setShiftCloseOpen,
    productLockedOpen,
    setProductLockedOpen,
    expiryWarnOpen: expiryWarnProduct !== null,
    closeExpiryWarn,
    firstSaleOpen,
    dismissFirstSale,
  });

  useEffect(() => {
    return registerPosLeaveGuard({
      hasActiveSale: () => draftLines.length > 0,
      confirmLeave: async () => {
        const ok = window.confirm(t(lang, "posLeaveActiveSaleConfirm"));
        if (ok) usePosStore.getState().clearDraft();
        return ok;
      },
    });
  }, [draftLines.length, lang]);

  useEffect(() => {
    return registerPosExitHandler({
      confirmPosExit: () =>
        new Promise((resolve) => {
          posExitResolverRef.current = resolve;
          setPosExitOpen(true);
        }),
    });
  }, []);

  const moneyPresets = selected?.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = selected?.quickPresetsQty?.filter((x) => x > 0) ?? [];
  const sellPresets = selected ? getPosSellPresets(selected) : [];
  const keyboardInset = useKeyboardInset();
  const checkoutBottomPad = combinedBottomInsetStyle(keyboardInset) ?? "env(safe-area-inset-bottom, 0px)";

  const adjustFocusedCartQty = useCallback(
    (backwards: boolean) => {
      const lastLine = draftLines[draftLines.length - 1];
      if (!lastLine) return;
      handleDraftQtyStep(lastLine, backwards);
    },
    [draftLines, handleDraftQtyStep],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isActiveMoneyInput(event.target)) {
        if (applyMoneyInputKey(event.target as HTMLInputElement, event.key)) {
          event.preventDefault();
          return;
        }
      }

      const shortcutModalState: PosShortcutModalState = {
        sheetOpen,
        qtyEditOpen: qtyEditLine !== null,
        discountLineOpen: discountLine !== null,
        cartSaleDiscountOpen,
        cameraScanOpen,
        expenseModalOpen,
        firstSaleOpen,
        productLockedOpen,
        expiryWarnOpen: expiryWarnProduct !== null,
        checkoutBlockModalOpen,
        receiptOpen: receiptSaleId !== null,
        shiftCloseOpen,
      };
      const modalOpen = isPosShortcutModalOpen(shortcutModalState);

      const action = resolvePosShortcutAction(event);
      if (!action) return;
      if (shouldBlockPosShortcutAction(action, modalOpen)) return;
      event.preventDefault();

      switch (action) {
        case "focus_search":
          searchInputRef.current?.focus();
          break;
        case "focus_checkout":
          if (isFullDesktopPos) {
            saveButtonRef.current?.focus();
          } else if (draftLines.length > 0) {
            setSaleCheckoutMinimized(false);
          }
          break;
        case "open_cart_discount":
          if (draftLines.length > 0) setCartSaleDiscountOpen(true);
          break;
        case "focus_customer":
          if (draftLines.length > 0) {
            setPaymentMethod("credit");
            setCheckoutAmountField("cash");
      setCheckoutKeypadMode("numeric");
            window.requestAnimationFrame(() => customerSelectRef.current?.focus());
          }
          break;
        case "confirm":
          if (sheetOpen && selected) {
            if (!(quickSell && !showAdvanced && sellPresets.length > 0)) applyDraftInput();
          } else {
            const confirmAction = resolveConfirmSaleAction({
              layoutMode: posLayoutMode,
              draftLineCount: draftLines.length,
              checkoutPanelOpen,
              activeElement: document.activeElement,
              checkoutRoot: checkoutPanelRef.current,
              saveButton: saveButtonRef.current,
            });
            if (confirmAction === "finish") finishSale();
            else if (confirmAction === "focus_checkout") saveButtonRef.current?.focus();
          }
          break;
        case "close":
          if (receiptSaleId) setReceiptSaleId(null);
          else if (cameraScanOpen) setCameraScanOpen(false);
          else if (checkoutBlockModalOpen) setCheckoutBlockModalOpen(false);
          else if (cartSaleDiscountOpen) setCartSaleDiscountOpen(false);
          else if (discountLine) setDiscountLine(null);
          else if (qtyEditLine) setQtyEditLine(null);
          else if (sheetOpen) setSheetOpen(false);
          else if (checkoutPanelOpen) setSaleCheckoutMinimized(true);
          else if (productLockedOpen) setProductLockedOpen(false);
          else if (expiryWarnProduct) closeExpiryWarn();
          else if (firstSaleOpen) dismissFirstSale();
          else if (shiftCloseOpen) setShiftCloseOpen(false);
          else if (expenseModalOpen) setExpenseModalOpen(false);
          break;
        case "increment_qty":
          adjustFocusedCartQty(false);
          break;
        case "decrement_qty":
          adjustFocusedCartQty(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    adjustFocusedCartQty,
    applyDraftInput,
    cameraScanOpen,
    cartSaleDiscountOpen,
    checkoutBlockModalOpen,
    closeExpiryWarn,
    discountLine,
    dismissFirstSale,
    draftLines.length,
    expenseModalOpen,
    expiryWarnProduct,
    finishSale,
    firstSaleOpen,
    posLayoutMode,
    checkoutPanelOpen,
    productLockedOpen,
    qtyEditLine,
    quickSell,
    receiptSaleId,
    selected,
    sellPresets.length,
    sheetOpen,
    shiftCloseOpen,
    showAdvanced,
  ]);

  useEffect(() => {
    if (draftLines.length === 0) setCatalogNumpadOpen(false);
  }, [draftLines.length]);

  useEffect(() => {
    if (paymentMethod !== "cash" && paymentMethod !== "credit") {
      setCatalogNumpadOpen(false);
    }
  }, [paymentMethod]);

  const prevDraftLineCountRef = useRef(draftLines.length);
  useEffect(() => {
    if (isFullDesktopPos && prevDraftLineCountRef.current === 0 && draftLines.length > 0) {
      setSaleCheckoutMinimized(false);
    }
    prevDraftLineCountRef.current = draftLines.length;
  }, [draftLines.length, isFullDesktopPos]);

  const focusCatalogForAdd = useCallback(() => {
    setCatalogNumpadOpen(false);
    if (isFullDesktopPos) setSaleCheckoutMinimized(true);
    catalogRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const checkoutPanelCommon = {
    lang,
    saleTitle: hospitalityMode ? ht("thisSale") : t(lang, "thisSale"),
    clearSaleLabel: modeTerm("clearSale"),
    saveSaleLabel: modeTerm("saveSale"),
    draftLines,
    draftCartStats,
    checkoutTotals,
    draftPayable,
    draftDiscountTotal,
    productById,
    checkoutBlockMessage,
    paymentMethod,
    checkoutMethods,
    cashInput,
    mobileMoneyInput,
    checkoutAmountField,
    checkoutKeypadMode,
    changeDue,
    computedDebt,
    saleCustomerId,
    saleCustomerName,
    saleCustomerPhone,
    customers,
    canSavePending,
    savePendingLabel: t(lang, "saveAsPending"),
    customerSelectRef,
    saveButtonRef,
    checkoutPanelRef,
    onClearDraft: clearDraft,
    onIncrement: (line: SaleLine) => handleDraftQtyStep(line, false),
    onDecrement: (line: SaleLine) => handleDraftQtyStep(line, true),
    onQtyTap: setQtyEditLine,
    onLineDiscount: setDiscountLine,
    onRemoveLine: removeDraftLine,
    onOpenCartDiscount: () => setCartSaleDiscountOpen(true),
    pharmacyMode,
    onBatchTap: pharmacyMode ? setBatchPickerLine : undefined,
    onPaymentMethod: setPaymentMethod,
    onCheckoutInputField: handleCheckoutInputField,
    onCheckoutKeypadModeChange: setCheckoutKeypadMode,
    onAppendCheckoutDigit: appendCheckoutDigit,
    onClearCheckoutAmount: clearCheckoutAmount,
    onSaleCustomerId: setSaleCustomerId,
    onSaleCustomerName: setSaleCustomerName,
    onSaleCustomerPhone: setSaleCustomerPhone,
    onSavePending: handleSavePending,
    onFinishSale: finishSale,
  };

  const mobileSellFocus = posLayoutMode === "mobile";
  const catalogSellMode = mobileSellFocus || isFullDesktopPos;

  const showCatalogShelfGrid =
    catalogSellMode && shelfCards.length > 0 && sellSearchContext.q.length === 0;
  const showCatalogProductsBelow =
    showCatalogShelfGrid && sellCategoryKey !== CATEGORY_FILTER_ALL;
  /** Mobile + full desktop: open shelf products full-screen instead of below the grid. */
  const catalogShelfDrillDown = catalogSellMode && showCatalogProductsBelow;
  const showCatalogSearchResults = catalogSellMode && sellSearchContext.q.length > 0;
  const showDesktopProductView = !catalogSellMode && hasSellViewFilter;

  const catalogShelfCards = shelfCards;

  const quickProductChips = useMemo(() => {
    if (!mobileSellFocus) return [];
    const seen = new Set<string>();
    const out: Product[] = [];
    for (const p of quickSellProducts) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    }
    for (const { product } of frequentToday) {
      if (!seen.has(product.id) && out.length < 12) {
        seen.add(product.id);
        out.push(product);
      }
    }
    return out.slice(0, 12);
  }, [mobileSellFocus, quickSellProducts, frequentToday]);

  const handleCatalogShelfTap = useCallback(
    (shelfKey: string) => {
      setSellCategoryFilter(shelfKey);
    },
    [setSellCategoryFilter],
  );

  const renderCatalogProductGrid = () => {
    if (filteredProducts.length === 0) {
      if (sellCategoryKey !== CATEGORY_FILTER_ALL) {
        return (
          <EmptyShelfPanel
            lang={lang}
            shelfLabel={selectedShelfLabel}
            canAdd={actorHasPermission(actor, "products.add")}
            onAddProduct={() =>
              navigate(
                `/stock?tab=shelves&shelf=${encodeURIComponent(sellCategoryKey)}&add=1`,
              )
            }
          />
        );
      }
      return (
        <p className="rounded-xl bg-amber-50 px-3 py-4 text-center text-sm font-bold text-amber-950">
          {t(lang, "posSellNoMatch")}
        </p>
      );
    }
    if (filteredProducts.length > VIRTUAL_PRODUCT_THRESHOLD) {
      return (
        <VirtualizedProductGrid
          products={filteredProducts}
          columnCount={productGridCols}
          onPick={openProduct}
          stockLabel={t(lang, "stockLabel")}
          noShelfLabel={t(lang, "posNoShelf")}
          addLabel={t(lang, "addToSale")}
          isLocked={(p) => isProductPlanLocked(p.id, lockedIds)}
          lockedBadge={t(lang, "productLockedBadge")}
          variant={isFullDesktopPos ? "sellDesktop" : "sellMobile"}
          favoriteIds={isFullDesktopPos ? favoriteIdSet : undefined}
          onToggleFavorite={isFullDesktopPos ? toggleFavoriteProduct : undefined}
        />
      );
    }
    if (isFullDesktopPos) {
      return (
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${productGridCols}, minmax(0, 1fr))` }}
        >
          {filteredProducts.map((p) => (
            <PosDesktopProductCard
              key={p.id}
              product={p}
              stockLabel={t(lang, "stockLabel")}
              sellLabel={t(lang, "addToSale")}
              locked={isProductPlanLocked(p.id, lockedIds)}
              lockedBadge={t(lang, "productLockedBadge")}
              favorite={favoriteIdSet.has(p.id)}
              onPick={openProduct}
              onToggleFavorite={toggleFavoriteProduct}
            />
          ))}
        </div>
      );
    }
    return (
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${productGridCols}, minmax(0, 1fr))` }}
      >
        {filteredProducts.map((p) => (
          <PosSellProductCard
            key={p.id}
            product={p}
            stockLabel={t(lang, "stockLabel")}
            addLabel={t(lang, "addToSale")}
            locked={isProductPlanLocked(p.id, lockedIds)}
            lockedBadge={t(lang, "productLockedBadge")}
            onPick={openProduct}
          />
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (!catalogSellMode || sellCategoryKey === CATEGORY_FILTER_ALL || sellSearchContext.q.length > 0) {
      return;
    }
    const scrollRoot = isFullDesktopPos
      ? catalogRef.current
      : document.querySelector(".scroll-main-chrome");
    if (scrollRoot instanceof HTMLElement) scrollRoot.scrollTop = 0;
  }, [catalogSellMode, isFullDesktopPos, sellCategoryKey, sellSearchContext.q]);

  const sellActionFooter =
    draftLines.length > 0 ||
    canSavePending ||
    canRecordCashExpenses(actor.role, shopPreferences, actor.permissions) ||
    activeShift ? (
      mobileSellFocus ? (
        <PosSellActionChips>
          {draftLines.length > 0 ? (
            <PosSellActionChip onClick={() => clearDraft()}>{modeTerm("clearSale")}</PosSellActionChip>
          ) : null}
          {canSavePending ? (
            <Link to="/pending-sales" className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-bold text-foreground active:bg-muted">
              {t(lang, "pendingSalesLink")}
              {pendingCount > 0 ? (
                <span className="rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-black text-amber-950">
                  {pendingCount}
                </span>
              ) : null}
            </Link>
          ) : null}
          {canRecordCashExpenses(actor.role, shopPreferences, actor.permissions) ? (
            <PosSellActionChip onClick={() => setExpenseModalOpen(true)}>
              <Banknote className="h-3 w-3 shrink-0" aria-hidden />
              {t(lang, "posRecordExpenseBtn")}
            </PosSellActionChip>
          ) : null}
          {activeShift ? (
            <PosSellActionChip onClick={() => setShiftCloseOpen(true)}>{t(lang, "shiftCloseBtn")}</PosSellActionChip>
          ) : null}
        </PosSellActionChips>
      ) : (
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
          {draftLines.length > 0 ? (
            <button
              type="button"
              onClick={() => clearDraft()}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white active:bg-white/25"
            >
              {modeTerm("clearSale")}
            </button>
          ) : null}
          {canSavePending ? (
            <Link
              to="/pending-sales"
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white active:bg-white/25"
            >
              {t(lang, "pendingSalesLink")}
              {pendingCount > 0 ? (
                <span className="rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-black text-amber-950">
                  {pendingCount}
                </span>
              ) : null}
            </Link>
          ) : null}
          {canRecordCashExpenses(actor.role, shopPreferences, actor.permissions) ? (
            <button
              type="button"
              onClick={() => setExpenseModalOpen(true)}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white active:bg-white/25"
            >
              <Banknote className="h-3 w-3 shrink-0" aria-hidden />
              {t(lang, "posRecordExpenseBtn")}
            </button>
          ) : null}
          {activeShift ? (
            <button
              type="button"
              onClick={() => setShiftCloseOpen(true)}
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white active:bg-white/25"
            >
              {t(lang, "shiftCloseBtn")}
            </button>
          ) : null}
        </div>
      )
    ) : undefined;

  if (!actorHasPermission(actor, "pos.sell")) {
    return <Navigate to="/" replace />;
  }

  return (
    <ShiftSellGateway lang={lang}>
    <div className={clsx(isFullDesktopPos || mobileSellFocus ? "flex h-full min-h-0 flex-1 flex-col" : "space-y-2", mobileSellFocus && !isFullDesktopPos && "min-h-0")}>
      <PosOfflineBanner lang={lang} compact={mobileSellFocus || isFullDesktopPos} />
      {isFullDesktopPos ? (
        <PosDesktopCompactHeader
          lang={lang}
          sellLabelKey={sellNavLabelKey}
          cashierName={actor.displayName ?? actor.userId}
          shift={activeShift}
          todaySaleCount={todaySalesSummary.count}
          todaySalesUgx={todaySalesSummary.total}
          pendingCount={pendingCount}
          onCloseShift={() => setShiftCloseOpen(true)}
        />
      ) : activeShift && mobileSellFocus ? (
        <PosShiftSummaryCollapsible
          lang={lang}
          shift={activeShift}
          cashierName={actor.displayName ?? actor.userId}
          todaySaleCount={todaySalesSummary.count}
          todaySalesUgx={todaySalesSummary.total}
          pendingCount={pendingCount}
          onCloseShift={() => setShiftCloseOpen(true)}
          onRecordExpense={() => setExpenseModalOpen(true)}
          canRecordExpense={canRecordCashExpenses(actor.role, shopPreferences, actor.permissions)}
          canSavePending={canSavePending}
        />
      ) : activeShift ? (
        <ActiveShiftBanner
          lang={lang}
          shift={activeShift}
          cashierName={actor.displayName ?? actor.userId}
          onCloseShift={() => setShiftCloseOpen(true)}
        />
      ) : null}
      {!isFullDesktopPos ? <PosOperationalNav lang={lang} sellLabelKey={sellNavLabelKey} /> : null}
      {!mobileSellFocus && !isFullDesktopPos ? (
        <PosSellHeroCard
          lang={lang}
          sellLabel={t(lang, sellNavLabelKey)}
          dense={posLayoutMode === "compact"}
          cartStats={draftCartStats}
          cartHasItems={draftLines.length > 0}
          payableUgx={draftPayable}
          cartDiscountUgx={draftCartDiscountUgx}
          todaySaleCount={todaySalesSummary.count}
          todaySalesUgx={todaySalesSummary.total}
          pendingCount={pendingCount}
          actionFooter={sellActionFooter}
        />
      ) : null}

      {lockedProductCount > 0 ? (
        <div className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 text-sm font-bold text-waka-950">
          {t(lang, "freePlanLockedProductsNotice")
            .replace("{{locked}}", String(lockedProductCount))
            .replace("{{limit}}", String(productLimit ?? 7))}
        </div>
      ) : null}

      <div
        className={clsx(
          mountDesktopCheckoutSidebar && isFullDesktopPos && "grid min-h-0 flex-1 items-stretch gap-2",
        )}
        style={posSplitColumns ? { gridTemplateColumns: posSplitColumns } : undefined}
      >
        <div
          ref={catalogRef}
          className={clsx(isFullDesktopPos ? "flex min-h-0 min-w-0 flex-col gap-1.5" : mobileSellFocus ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "min-w-0 space-y-2")}
        >

      {products.length > 0 ? (
        <div
          className={clsx(
            mobileSellFocus
              ? "sticky top-0 z-20 -mx-0.5 space-y-0 bg-muted/95 pb-1.5 pt-0.5 backdrop-blur-md"
              : isFullDesktopPos
                ? "shrink-0 space-y-1"
                : "space-y-1.5 rounded-[1.35rem] border border-border bg-card p-2 shadow-waka-sm",
          )}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={(e) => commitSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSearch(searchQuery);
              }}
              placeholder={
                isFullDesktopPos
                  ? t(lang, "posDesktopSearchPlaceholder")
                  : pharmacyMode || hospitalityMode || wholesaleMode
                    ? modeTerm("searchPlaceholder")
                    : t(lang, "posSellSearchPlaceholder")
              }
              aria-label={
                isFullDesktopPos
                  ? t(lang, "posDesktopSearchPlaceholder")
                  : pharmacyMode || hospitalityMode || wholesaleMode
                    ? modeTerm("searchPlaceholder")
                    : t(lang, "posSellSearchPlaceholder")
              }
              className={clsx(
                "pos-ds-input w-full rounded-2xl border border-border bg-card pl-9 pr-10 font-semibold text-foreground outline-none ring-waka-200 placeholder:text-muted-foreground transition-shadow focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80",
                mobileSellFocus
                  ? "h-12 text-base shadow-sm"
                  : isFullDesktopPos
                    ? "h-10 bg-muted/90 text-sm focus:bg-card focus:ring-1"
                    : "h-11 bg-muted/90 text-base focus:bg-card focus:ring-1",
              )}
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-11 min-h-[44px] w-11 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
              onClick={() => {
                if (searchQuery.trim()) setSearchQuery("");
                else if (detectBarcodeCapabilities().cameraScan) setCameraScanOpen(true);
              }}
              aria-label={searchQuery.trim() ? t(lang, "posClearSearch") : t(lang, "posBarcodeSoon")}
            >
              {searchQuery.trim() ? <X className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
            </button>
          </div>
          {!mobileSellFocus && !isFullDesktopPos && recentSearches.length > 0 ? (
            <ul
              className="m-0 flex max-w-full list-none gap-1 overflow-x-auto p-0 pb-0.5"
              aria-label={t(lang, "posRecentSearches")}
            >
              {recentSearches.map((item) => (
                <li key={item} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setSearchQuery(item)}
                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground active:bg-muted"
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!mobileSellFocus && !isFullDesktopPos && frequentTodayVisible.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "posFrequentToday")}</p>
              <div className="mt-1 flex max-w-full gap-1 overflow-x-auto pb-0.5">
                {frequentTodayVisible.map(({ product, qty }) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => openProduct(product)}
                    className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 active:bg-amber-100"
                  >
                    {product.name} · {qty}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!mobileSellFocus && !isFullDesktopPos && favoriteProductsVisible.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "posFavorites")}</p>
              <div className="mt-1 flex max-w-full gap-1 overflow-x-auto pb-0.5">
                {favoriteProductsVisible.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openProduct(p)}
                    className="shrink-0 rounded-full border border-waka-300 bg-waka-50 px-2 py-0.5 text-xs font-bold text-waka-950 active:bg-waka-100"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!mobileSellFocus && !isFullDesktopPos && recentProductsVisible.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "posRecentProducts")}</p>
              <div className="mt-1 flex max-w-full gap-1 overflow-x-auto pb-0.5">
                {recentProductsVisible.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openProduct(p)}
                      className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-foreground active:bg-muted"
                    >
                      {p.name}
                    </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {mobileSellFocus && quickProductChips.length > 0 ? (
        <PosQuickProductChips lang={lang} products={quickProductChips} onTap={quickTapAddProduct} />
      ) : null}

      {showDesktopCatalogCheckoutDock ? (
        <PosDesktopCatalogCheckoutDock
          lang={lang}
          paymentMethod={paymentMethod}
          catalogNumpadOpen={catalogNumpadOpen}
          onCatalogNumpadOpenChange={setCatalogNumpadOpen}
          cashInput={cashInput}
          mobileMoneyInput={mobileMoneyInput}
          checkoutAmountField={checkoutAmountField}
          checkoutKeypadMode={checkoutKeypadMode}
          changeDue={changeDue}
          computedDebt={computedDebt}
          saleCustomerId={saleCustomerId}
          saleCustomerName={saleCustomerName}
          saleCustomerPhone={saleCustomerPhone}
          customers={customers}
          customerSelectRef={customerSelectRef}
          saveButtonRef={saveButtonRef}
          saveSaleLabel={modeTerm("saveSale")}
          saveDisabled={draftLines.length === 0}
          onCheckoutInputField={handleCheckoutInputField}
          onCheckoutKeypadModeChange={setCheckoutKeypadMode}
          onAppendCheckoutDigit={appendCheckoutDigit}
          onClearCheckoutAmount={clearCheckoutAmount}
          onSaleCustomerId={setSaleCustomerId}
          onSaleCustomerName={setSaleCustomerName}
          onSaleCustomerPhone={setSaleCustomerPhone}
          onFinishSale={finishSale}
        />
      ) : products.length === 0 && shelfCards.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-border bg-muted p-8 text-center">
          <p className="text-2xl font-black text-foreground">{t(lang, "posEmptyTitle")}</p>
          <p className="mt-2 text-lg text-muted-foreground">{t(lang, "posEmptySub")}</p>
          {actorHasPermission(actor, "products.add") ? (
            <Link
              to="/stock"
              className="mt-6 inline-flex min-h-[56px] items-center justify-center rounded-3xl bg-waka-600 px-8 py-4 text-xl font-black text-white shadow-lg active:bg-waka-700"
            >
              {t(lang, "posEmptyCtaProducts")}
            </Link>
          ) : (
            <p className="mt-4 text-base font-semibold text-muted-foreground">{t(lang, "posEmptyAskOwner")}</p>
          )}
        </section>
      ) : showCatalogShelfGrid ? (
        catalogShelfDrillDown ? (
          <section
            className={clsx(
              "space-y-2",
              catalogSellMode && "min-h-0 flex-1 overflow-y-auto overscroll-y-contain",
            )}
            data-pos-catalog-scroll={catalogSellMode ? true : undefined}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-[1.35rem] border border-waka-200 bg-card/95 px-2.5 py-2 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => setSellCategoryFilter(CATEGORY_FILTER_ALL)}
                className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden />
                {t(lang, "posBackToShelves")}
              </button>
              <p className="min-w-0 flex-1 truncate text-right text-sm font-black text-foreground">
                {shelfIconFor(selectedShelfLabel) ? (
                  <span className="mr-1" aria-hidden>
                    {shelfIconFor(selectedShelfLabel)}
                  </span>
                ) : null}
                {selectedShelfLabel}
              </p>
            </div>
            {renderCatalogProductGrid()}
          </section>
        ) : (
          <div
            className={clsx(catalogSellMode && "pos-catalog-scroll-pane min-h-0 flex-1")}
            data-pos-catalog-scroll={catalogSellMode ? true : undefined}
          >
            <PosSellCatalogShelfSection
              lang={lang}
              shelves={catalogShelfCards}
              onShelfTap={handleCatalogShelfTap}
              desktop={isFullDesktopPos}
            />
          </div>
        )
      ) : showCatalogSearchResults ? (
        <section className={clsx("space-y-2", catalogSellMode && "min-h-0 flex-1 overflow-y-auto overscroll-y-contain")}>
          <p className="px-0.5 text-xs font-black text-muted-foreground">
            {t(lang, "posSearchResults")}
            <span className="font-semibold text-muted-foreground"> · {t(lang, "posMasterSearchAll")}</span>
            {filteredProducts.length > 0 ? (
              <span className="font-semibold text-muted-foreground"> ({filteredProducts.length})</span>
            ) : null}
          </p>
          {filteredProducts.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-4 text-center text-sm font-bold text-amber-950">
              {t(lang, "posSellNoMatch")}
            </p>
          ) : filteredProducts.length > VIRTUAL_PRODUCT_THRESHOLD ? (
            <VirtualizedProductGrid
              products={filteredProducts}
              columnCount={productGridCols}
              onPick={openProduct}
              stockLabel={t(lang, "stockLabel")}
              noShelfLabel={t(lang, "posNoShelf")}
              addLabel={t(lang, "addToSale")}
              isLocked={(p) => isProductPlanLocked(p.id, lockedIds)}
              lockedBadge={t(lang, "productLockedBadge")}
              variant={isFullDesktopPos ? "sellDesktop" : "sellMobile"}
              favoriteIds={isFullDesktopPos ? favoriteIdSet : undefined}
              onToggleFavorite={isFullDesktopPos ? toggleFavoriteProduct : undefined}
            />
          ) : isFullDesktopPos ? (
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${productGridCols}, minmax(0, 1fr))` }}
            >
              {filteredProducts.map((p) => (
                <PosDesktopProductCard
                  key={p.id}
                  product={p}
                  stockLabel={t(lang, "stockLabel")}
                  sellLabel={t(lang, "addToSale")}
                  locked={isProductPlanLocked(p.id, lockedIds)}
                  lockedBadge={t(lang, "productLockedBadge")}
                  favorite={favoriteIdSet.has(p.id)}
                  onPick={openProduct}
                  onToggleFavorite={toggleFavoriteProduct}
                />
              ))}
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${productGridCols}, minmax(0, 1fr))` }}
            >
              {filteredProducts.map((p) => (
                <PosSellProductCard
                  key={p.id}
                  product={p}
                  stockLabel={t(lang, "stockLabel")}
                  addLabel={t(lang, "addToSale")}
                  locked={isProductPlanLocked(p.id, lockedIds)}
                  lockedBadge={t(lang, "productLockedBadge")}
                  onPick={openProduct}
                />
              ))}
            </div>
          )}
        </section>
      ) : showShelfBoxes ? (
        <section className="space-y-2.5">
          <div className="flex items-center justify-end gap-2">
            <p className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-black text-muted-foreground">
              {products.length}
            </p>
          </div>

          {quickSellProducts.length > 0 ? (
            <div className="rounded-2xl border border-waka-200 bg-gradient-to-br from-waka-50 to-waka-50/80 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  {quickSellShelf?.icon ?? "⚡"}
                </span>
                <p className="text-xs font-black uppercase tracking-wide text-waka-900">
                  {quickSellShelf?.label ?? t(lang, "posQuickSellShelf")}
                </p>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
                {quickSellProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => quickTapAddProduct(p)}
                    className="shrink-0 rounded-xl border border-waka-200/90 bg-card px-3 py-2 text-left shadow-sm active:border-waka-400 active:bg-waka-50"
                  >
                    <span className="block max-w-[7rem] truncate text-sm font-black text-foreground">{p.name}</span>
                    <span className="text-[10px] font-bold text-waka-700">UGX {p.sellingPricePerUnitUgx.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={shelfMasonryGridClass(mobileSellFocus)}>
            {shelfCards.map((shelf) => (
              <PosShelfTile
                key={shelf.key}
                shelf={shelf}
                lang={lang}
                mode="sell"
                sellFocus={mobileSellFocus}
                countLabel={t(lang, "posShelfProductCount").replace("{{count}}", String(shelf.count))}
                onClick={() => setSellCategoryFilter(shelf.key)}
              />
            ))}
          </div>
        </section>
      ) : showDesktopProductView && filteredProducts.length === 0 ? (
        <section className={clsx("space-y-2", isFullDesktopPos && "min-h-0 flex-1")}>
          {hasSellViewFilter && !isFullDesktopPos ? (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-[1.35rem] border border-waka-200 bg-card/95 px-2.5 py-2 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={clearSellView}
                className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden />
                {t(lang, "posBackToShelves")}
              </button>
              <p className="min-w-0 flex-1 truncate text-right text-sm font-black text-foreground">
                {sellSearchContext.q ? t(lang, "posSearchResults") : selectedShelfLabel}
              </p>
            </div>
          ) : null}
          <p className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-lg font-bold text-amber-950">{t(lang, "posSellNoMatch")}</p>
        </section>
      ) : showDesktopProductView ? (
        <section
          className={clsx("space-y-2", catalogSellMode && "min-h-0 flex-1 overflow-y-auto overscroll-y-contain")}
          data-pos-catalog-scroll={isFullDesktopPos ? true : undefined}
        >
          {!isFullDesktopPos ? (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-[1.35rem] border border-waka-200 bg-card/95 px-2.5 py-2 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={clearSellView}
              className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
              {t(lang, "posBackToShelves")}
            </button>
            <p className="min-w-0 flex-1 truncate text-right text-sm font-black text-foreground">
              {sellCategoryKey !== CATEGORY_FILTER_ALL && shelfIconFor(selectedShelfLabel) ? (
                <span className="mr-1" aria-hidden>
                  {shelfIconFor(selectedShelfLabel)}
                </span>
              ) : null}
              {sellSearchContext.q ? t(lang, "posSearchResults") : selectedShelfLabel}
            </p>
          </div>
          ) : null}
          {filteredProducts.length > VIRTUAL_PRODUCT_THRESHOLD ? (
            <VirtualizedProductGrid
              products={filteredProducts}
              columnCount={productGridCols}
              onPick={openProduct}
              stockLabel={t(lang, "stockLabel")}
              noShelfLabel={t(lang, "posNoShelf")}
              addLabel={t(lang, "addToSale")}
              isLocked={(p) => isProductPlanLocked(p.id, lockedIds)}
              lockedBadge={t(lang, "productLockedBadge")}
              variant={isFullDesktopPos ? "sellDesktop" : "default"}
              favoriteIds={isFullDesktopPos ? favoriteIdSet : undefined}
              onToggleFavorite={isFullDesktopPos ? toggleFavoriteProduct : undefined}
            />
          ) : (
            <div
              className={clsx("grid", isFullDesktopPos ? "gap-1.5" : "gap-2.5")}
              style={{ gridTemplateColumns: `repeat(${productGridCols}, minmax(0, 1fr))` }}
            >
              {filteredProducts.map((p) => {
                const locked = isProductPlanLocked(p.id, lockedIds);
                if (isFullDesktopPos) {
                  return (
                    <PosDesktopProductCard
                      key={p.id}
                      product={p}
                      stockLabel={t(lang, "stockLabel")}
                      sellLabel={t(lang, "addToSale")}
                      locked={locked}
                      lockedBadge={t(lang, "productLockedBadge")}
                      favorite={favoriteIdSet.has(p.id)}
                      onPick={openProduct}
                      onToggleFavorite={toggleFavoriteProduct}
                    />
                  );
                }
                return (
                <article
                  key={p.id}
                  className={clsx(
                    "relative flex min-h-[132px] flex-col justify-between rounded-[1.35rem] border p-3 pt-10 text-left shadow-sm",
                    locked
                      ? "border-border/80 bg-muted/90 opacity-55"
                      : "border-border bg-card active:border-waka-400",
                  )}
                  style={{ contentVisibility: "auto" }}
                >
                  {locked ? (
                    <span className="absolute left-2.5 top-2.5 rounded-full bg-foreground/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-background">
                      {t(lang, "productLockedBadge")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="absolute right-2.5 top-2.5 flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-full border border-border bg-card text-base shadow-sm active:bg-muted"
                      aria-label={favoriteIdSet.has(p.id) ? t(lang, "posRemoveFavorite") : t(lang, "posToggleFavorite")}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavoriteProduct(p.id);
                    }}
                  >
                    {favoriteIdSet.has(p.id) ? "★" : "☆"}
                  </button>
                  <button type="button" onClick={() => openProduct(p)} className="text-left">
                    <p className="line-clamp-2 pr-7 text-base font-black leading-tight text-foreground">{p.name}</p>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-muted-foreground">
                      {shelfIconFor(p.category ?? "") ? <span className="mr-1" aria-hidden>{shelfIconFor(p.category ?? "")}</span> : null}
                      {(p.category ?? "").trim() ? p.category.trim() : t(lang, "posNoShelf")}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs font-bold leading-snug text-muted-foreground">
                      {t(lang, "stockLabel")}: {formatStockLabel(p)}
                    </p>
                    {p.stockOnHand <= p.minimumStockAlert ? (
                      <p className="mt-0.5 text-[11px] font-bold text-rose-700">{t(lang, "cardLowStock")}</p>
                    ) : null}
                    <p className="mt-1.5 text-sm font-black text-waka-700">{formatProductPriceLabel(p)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => openProduct(p)}
                    className={clsx(
                      "mt-2 min-h-[44px] rounded-2xl px-3 py-2 text-base font-black",
                      locked
                        ? "border-2 border-border bg-muted text-muted-foreground"
                        : "bg-waka-600 text-white active:bg-waka-700",
                    )}
                  >
                    {locked ? t(lang, "productLockedTitle") : t(lang, "addToSale")}
                  </button>
                </article>
              );
              })}
            </div>
          )}
        </section>
      ) : null}

        <PosPageScrollSpacer minimizedCheckout={showMinimizedCheckoutFab} />
        </div>

        {mountDesktopCheckoutSidebar ? (
          <aside className={clsx(isFullDesktopPos ? "sticky top-0 min-h-0 self-stretch" : "sticky top-3")}>
            <PosCheckoutPanel
              variant="sidebar"
              {...checkoutPanelCommon}
              onAddItems={focusCatalogForAdd}
              catalogDock={useDesktopCatalogCheckoutDock}
              catalogNumpadOpen={catalogNumpadOpen}
              onCatalogNumpadOpenChange={setCatalogNumpadOpen}
            />
          </aside>
        ) : null}
      </div>

      {isFullDesktopPos ? <PosDesktopStatusBar lang={lang} /> : null}

      {mountCompactCheckoutSlideover ? (
        <PosCompactCheckoutSlideover
          open
          onClose={() => setSaleCheckoutMinimized(true)}
          checkoutBottomPad={checkoutBottomPad}
        >
          <PosCheckoutPanel
            variant="overlay"
            {...checkoutPanelCommon}
            onMinimize={() => setSaleCheckoutMinimized(true)}
          />
        </PosCompactCheckoutSlideover>
      ) : null}

      {mountMobileCheckoutOverlay ? (
        <PosScreenPortal>
          <div
            className="waka-overlay-full fixed inset-0 z-[var(--waka-z-pos-overlay)] flex min-h-0 flex-col pt-[env(safe-area-inset-top,0px)] md:hidden"
            style={{
              paddingBottom: checkoutBottomPad,
            }}
            role="dialog"
            aria-modal
            aria-labelledby="pos-checkout-title"
          >
            <PosCheckoutPanel
              variant="overlay"
              {...checkoutPanelCommon}
              onMinimize={() => setSaleCheckoutMinimized(true)}
            />
          </div>
        </PosScreenPortal>
      ) : null}

      {showMinimizedCheckoutFab ? (
        <PosMinimizedCheckoutFab
          lang={lang}
          variant={posLayoutMode === "mobile" ? "mobile" : "compact"}
          productCount={draftCartStats.productCount}
          unitCount={
            Number.isInteger(draftCartStats.unitCount)
              ? draftCartStats.unitCount
              : draftCartStats.unitCount.toFixed(2).replace(/\.?0+$/, "")
          }
          payableUgx={draftPayable}
          onOpen={() => setSaleCheckoutMinimized(false)}
        />
      ) : null}

      {sheetOpen && selected && (
        <PosScreenPortal>
        <div
          className="waka-overlay-full fixed inset-0 flex min-h-0 flex-col bg-card pt-[max(0.5rem,env(safe-area-inset-top,0px))] waka-overlay-clear-nav"
          style={
            keyboardInset > 0
              ? { paddingBottom: combinedBottomInsetStyle(keyboardInset) ?? checkoutBottomPad }
              : undefined
          }
          role="dialog"
          aria-modal
          aria-labelledby="pos-add-sheet-title"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-border px-3 py-3">
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="min-h-[48px] shrink-0 rounded-2xl border-2 border-border px-4 py-2 text-sm font-bold text-muted-foreground active:bg-muted"
            >
              {t(lang, "cancel")}
            </button>
            <div className="min-w-0 flex-1 py-0.5 text-center">
              <p id="pos-add-sheet-title" className="text-lg font-black leading-snug text-foreground">
                {selected.name}
              </p>
              <p className="text-sm font-semibold leading-snug text-muted-foreground">{formatProductPriceLabel(selected)}</p>
              <p className="text-xs font-bold leading-snug text-muted-foreground">
                {pharmacyPackActive ? formatPharmacyStockPrimary(selected) : formatStockLabel(selected)}
              </p>
            </div>
            <span className="min-h-[48px] w-[5.5rem] shrink-0" aria-hidden />
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 pb-4 [-webkit-overflow-scrolling:touch]">
            {pharmacyPackActive && pharmacySellUnits.length > 0 ? (
              <div className="mb-4 grid grid-cols-3 gap-2">
                {pharmacySellUnits.map((unit) => {
                  const pkg = selected.pharmacyPackaging!;
                  const label =
                    unit === "box"
                      ? pkg.level2?.unit ?? "box"
                      : unit === "strip"
                        ? pkg.level1?.unit ?? "strip"
                        : pkg.baseUnit;
                  return (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => {
                        setPharmacySellUnit(unit);
                        setInputMode("quantity");
                        setDisplay("");
                      }}
                      className={clsx(
                        "min-h-[52px] rounded-2xl border-2 text-sm font-black capitalize",
                        pharmacySellUnit === unit
                          ? "border-waka-500 bg-waka-600 text-white"
                          : "border-border bg-card text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {(sellPresets.length > 0 || moneyPresets.length > 0 || qtyPresets.length > 0) && (
              <div className="space-y-3">
                <p className="text-center text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  {t(lang, "posWholesaleUnits")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {sellPresets.map((preset, i) => (
                    <button
                      key={`sell-${i}-${preset.mode}-${preset.value}`}
                      type="button"
                      onClick={() => applyPreset(preset.mode, preset.value)}
                      className="flex min-h-[72px] flex-col items-center justify-center rounded-2xl bg-waka-600 px-3 py-3 text-white shadow-md active:bg-waka-700"
                    >
                      <span className="text-lg font-black leading-tight">{preset.label}</span>
                      <span className="mt-0.5 text-sm font-bold text-waka-100">{preset.priceLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {quickSell && !showAdvanced ? (
              <button
                type="button"
                className="mt-6 min-h-[52px] w-full rounded-2xl border-2 border-dashed border-border py-4 text-lg font-bold text-muted-foreground active:bg-muted"
                onClick={() => setShowAdvanced(true)}
              >
                {t(lang, "otherAmount")}
              </button>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode("money");
                      setDisplay("");
                    }}
                    className={clsx(
                      "min-h-[52px] rounded-2xl py-4 text-lg font-black",
                      inputMode === "money" ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t(lang, "moneyTab")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputMode("quantity");
                      setDisplay("");
                    }}
                    className={clsx(
                      "min-h-[52px] rounded-2xl py-4 text-lg font-black",
                      inputMode === "quantity" ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t(lang, "qtyTab")}
                  </button>
                </div>

                <div className="mt-4 min-h-[76px] rounded-2xl bg-muted px-4 py-4 text-right text-5xl font-black tracking-tight text-foreground">
                  {display || "0"}
                  <span className="ml-2 text-xl font-bold text-muted-foreground">
                    {inputMode === "money"
                      ? "UGX"
                      : pharmacyPackActive
                        ? pharmacySellUnit === "box"
                          ? selected.pharmacyPackaging?.level2?.unit ?? "box"
                          : pharmacySellUnit === "strip"
                            ? selected.pharmacyPackaging?.level1?.unit ?? "strip"
                            : selected.pharmacyPackaging?.baseUnit ?? selected.baseUnit
                        : selected.baseUnit}
                  </span>
                </div>

                <div className="mt-4">
                  <Numpad allowDecimal={inputMode === "quantity"} onDigit={appendDigit} onClear={() => setDisplay("")} />
                </div>

              </>
            )}
            </div>
            <div className="shrink-0 border-t border-border bg-card p-4">
              {quickSell && !showAdvanced ? null : (
                <button
                  type="button"
                  onClick={applyDraftInput}
                  className="min-h-[56px] w-full rounded-2xl bg-foreground py-4 text-lg font-black text-background active:bg-foreground"
                >
                  {t(lang, "addToSale")}
                </button>
              )}
            </div>
          </div>
        </div>
        </PosScreenPortal>
      )}

      {saleSuccessFlash ? (
        <div
          className="pointer-events-none fixed inset-0 z-[55] flex items-center justify-center bg-waka-600/10"
          aria-hidden
        >
          <div
            className="flex h-28 w-28 items-center justify-center rounded-full bg-waka-600 text-white shadow-2xl animate-waka-sale-check"
            aria-hidden
          >
            <span className="text-5xl font-black">✓</span>
          </div>
        </div>
      ) : null}

      {receiptSale && receiptPlain && receiptDisplay ? (
        <PosScreenPortal>
        <div
          className="waka-overlay-full fixed inset-0 flex min-h-0 flex-col bg-card pt-[max(0.5rem,env(safe-area-inset-top,0px))] waka-overlay-clear-nav"
          role="dialog"
          aria-modal
          aria-labelledby="pos-receipt-title"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id="pos-receipt-title" className="text-xl font-black text-foreground">
              {t(lang, "receiptTitle")}
            </h2>
            <button
              type="button"
              onClick={() => setReceiptSaleId(null)}
              className="min-h-[44px] rounded-xl border-2 border-border px-4 py-2 text-sm font-bold text-muted-foreground active:bg-muted"
            >
              {t(lang, "receiptClose")}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-background px-4 py-4 pb-6 [-webkit-overflow-scrolling:touch]">
            <div
              className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-sm"
              dangerouslySetInnerHTML={{ __html: receiptHtmlPreview }}
            />
          </div>
          <footer className="shrink-0 space-y-2 border-t border-border bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
            {receiptSale ? (
              <DocumentActionsBar
                lang={lang}
                compact
                onPrint={() => {
                  const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
                  const ctx = buildSaleReceiptContext({
                    lang,
                    sale: receiptSale,
                    allSales: sales,
                    preferences: shopPreferences,
                    products,
                    actor,
                    customerName: cust?.name ?? null,
                    customerBalanceUgx: cust?.debtBalanceUgx ?? null,
                  });
                  void printSaleReceipt(ctx).then((r) => {
                    if (r.ok) {
                      logReceiptReprintAudit(receiptSale, ctx.receiptNumber);
                      if (isNativePrintPlatform()) setToast(t(lang, "receiptPrintNativeOpened"));
                    } else {
                      window.alert(t(lang, "receiptPrintBlocked"));
                    }
                  });
                }}
                onDownloadPdf={() => {
                  const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
                  const ctx = buildSaleReceiptContext({
                    lang,
                    sale: receiptSale,
                    allSales: sales,
                    preferences: shopPreferences,
                    products,
                    actor,
                    customerName: cust?.name ?? null,
                    customerBalanceUgx: cust?.debtBalanceUgx ?? null,
                  });
                  void downloadSaleReceiptPdf(ctx).then((ok) => {
                    if (ok) logReceiptPdfExportAudit(receiptSale, ctx.receiptNumber);
                    if (!ok) window.alert(t(lang, "receiptPdfFailed"));
                  });
                }}
                onSharePdf={() => {
                  const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
                  const ctx = buildSaleReceiptContext({
                    lang,
                    sale: receiptSale,
                    allSales: sales,
                    preferences: shopPreferences,
                    products,
                    actor,
                    customerName: cust?.name ?? null,
                    customerBalanceUgx: cust?.debtBalanceUgx ?? null,
                  });
                  void shareSaleReceiptPdf(ctx).then((ok) => {
                    if (!ok) window.alert(t(lang, "receiptPdfFailed"));
                  });
                }}
              />
            ) : null}
            <button
              type="button"
              className="min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-sm font-black text-white active:bg-waka-700"
              onClick={() => setReceiptSaleId(null)}
            >
              {t(lang, "receiptClose")}
            </button>
          </footer>
        </div>
        </PosScreenPortal>
      ) : null}

      <DiscountLineModal
        lang={lang}
        open={discountLine !== null}
        line={discountLine}
        onClose={() => setDiscountLine(null)}
        onApply={(newSellingPriceUgx) => {
          if (!discountLine) return;
          const r = applyDraftLineDiscount(discountLine.productId, "final", newSellingPriceUgx);
          if (!r.ok) {
            setToast(t(lang, r.errorKey ?? "saleError"));
            window.setTimeout(() => setToast(null), 2200);
            return;
          }
          setDiscountLine(null);
        }}
      />

      <CartSaleDiscountModal
        lang={lang}
        open={cartSaleDiscountOpen}
        lineSubtotalUgx={checkoutTotals.lineSubtotalUgx}
        currentDiscountUgx={checkoutTotals.cartDiscountUgx}
        onClose={() => setCartSaleDiscountOpen(false)}
        onApply={(discountUgx) => {
          const r = setDraftCartDiscount(discountUgx);
          if (!r.ok) {
            setToast(t(lang, r.errorKey ?? "saleError"));
            window.setTimeout(() => setToast(null), 2200);
            return;
          }
          setCartSaleDiscountOpen(false);
        }}
      />

      <ShiftCloseModal
        lang={lang}
        open={shiftCloseOpen}
        shift={activeShift}
        onClose={() => setShiftCloseOpen(false)}
        onConfirm={(counted, handoff) => {
          const r = closeShiftWithCashCount(counted, handoff);
          if (!r.ok) {
            setToast(t(lang, r.errorKey ?? "saleError"));
            window.setTimeout(() => setToast(null), 2200);
            return { ok: false };
          }
          setToast(t(lang, "shiftCloseConfirm"));
          window.setTimeout(() => setToast(null), 2200);
          return { ok: true };
        }}
      />

      <PosExitConfirmModal
        lang={lang}
        open={posExitOpen}
        onLock={() => {
          setPosExitOpen(false);
          posExitResolverRef.current?.("lock");
          posExitResolverRef.current = null;
        }}
        onContinue={() => {
          setPosExitOpen(false);
          posExitResolverRef.current?.("continue");
          posExitResolverRef.current = null;
        }}
        onCancel={() => {
          setPosExitOpen(false);
          posExitResolverRef.current?.("cancel");
          posExitResolverRef.current = null;
        }}
      />

      <RecordExpenseModal lang={lang} open={expenseModalOpen} onClose={() => setExpenseModalOpen(false)} />

      {qtyEditLine ? (
        <QuantityEditModal
          lang={lang}
          open
          productName={qtyEditLine.name}
          qtyLabel={
            productById.get(qtyEditLine.productId)
              ? formatDraftLineQty(productById.get(qtyEditLine.productId)!, qtyEditLine)
              : String(qtyEditLine.quantity)
          }
          initialQuantity={qtyEditLine.quantity}
          onClose={() => setQtyEditLine(null)}
          onConfirm={(quantity) => handleDraftQtyConfirm(qtyEditLine.productId, quantity)}
        />
      ) : null}

      {batchPickerLine && pharmacyMode ? (
        (() => {
          const product = productById.get(batchPickerLine.productId);
          if (!product) return null;
          return (
            <PharmacyFefoBatchPicker
              lang={lang}
              product={product}
              line={batchPickerLine}
              onClose={() => setBatchPickerLine(null)}
              onConfirm={(batchId, reason) => {
                setDraftLineBatchOverride(batchPickerLine.productId, batchId, reason);
                setBatchPickerLine(null);
              }}
            />
          );
        })()
      ) : null}

      <ProductLockedModal lang={lang} open={productLockedOpen} onClose={() => setProductLockedOpen(false)} />

      {expiryWarnProduct ? (
        <AppModalOverlay className="z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
          <div className="max-w-md rounded-[2rem] bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-black text-red-950">{t(lang, "pharmacyExpiredSaleWarnTitle")}</h2>
            <p className="mt-3 text-base font-medium text-muted-foreground">
              {t(lang, "pharmacyExpiredSaleWarnBody")
                .replace("{name}", expiryWarnProduct.name)
                .replace("{date}", expiryWarnProduct.expiryDate ?? "—")}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                className="min-h-[52px] w-full rounded-2xl bg-red-600 py-3 text-lg font-black text-white active:bg-red-700"
                onClick={() => {
                  const run = pendingExpiredAddRef.current;
                  pendingExpiredAddRef.current = null;
                  setExpiryWarnProduct(null);
                  run?.();
                }}
              >
                {t(lang, "pharmacyExpiredSaleContinue")}
              </button>
              <button
                type="button"
                className="min-h-[52px] w-full rounded-2xl border-2 border-border py-3 text-lg font-bold text-foreground active:bg-muted"
                onClick={() => {
                  pendingExpiredAddRef.current = null;
                  setExpiryWarnProduct(null);
                }}
              >
                {t(lang, "cancel")}
              </button>
            </div>
          </div>
        </AppModalOverlay>
      ) : null}

      {checkoutBlockModalOpen && checkoutBlockMessage ? (
        <AppModalOverlay className="z-[95] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
          <div className="max-w-md rounded-[2rem] bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-black text-red-950">{t(lang, "pharmacyExpiredCheckoutBlockedTitle")}</h2>
            <p className="mt-3 text-base font-medium text-muted-foreground">{checkoutBlockMessage}</p>
            <button
              type="button"
              className="mt-6 min-h-[52px] w-full rounded-2xl bg-foreground py-3 text-lg font-black text-background"
              onClick={() => setCheckoutBlockModalOpen(false)}
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </AppModalOverlay>
      ) : null}

      {pharmacyMode && controlledCheckout.hasControlledLines ? (
        <PharmacyControlledDispenseGate
          lang={lang}
          open={controlledCheckout.gateOpen}
          validation={controlledCheckout.validation}
          prescription={selectedPharmacyRx}
          patientName={selectedPatientForGate}
          onClose={() => controlledCheckout.setGateOpen(false)}
          onApproved={onControlledGateApproved}
        />
      ) : null}

      {toast && (
        <div className="pointer-events-none fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.5rem)] left-1/2 z-[100] max-w-sm -translate-x-1/2 rounded-2xl bg-foreground px-5 py-4 text-center text-base font-semibold text-background shadow-xl">
          {toast}
        </div>
      )}

      {firstSaleOpen ? (
        <AppModalOverlay className="z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
          <div className="max-w-md rounded-[2rem] bg-gradient-to-b from-amber-100 to-card p-8 text-center shadow-2xl">
            <p className="text-4xl" aria-hidden>
              🎉
            </p>
            <p className="mt-4 text-3xl font-black text-foreground">{t(lang, "firstSaleTitle")}</p>
            <p className="mt-3 text-lg text-muted-foreground">{t(lang, "firstSaleBody")}</p>
            <div className="mt-8 flex flex-col gap-3">
              <Link
                to="/"
                className="block min-h-[52px] w-full rounded-2xl bg-waka-600 py-4 text-center text-lg font-black text-white active:bg-waka-700"
                onClick={() => {
                  dismissFirstSale();
                }}
              >
                {t(lang, "firstSaleSeeHome")}
              </Link>
              <button
                type="button"
                className="min-h-[52px] w-full rounded-2xl border-2 border-border py-4 text-lg font-bold text-foreground active:bg-muted"
                onClick={() => {
                  dismissFirstSale();
                }}
              >
                {t(lang, "firstSaleContinue")}
              </button>
            </div>
          </div>
        </AppModalOverlay>
      ) : null}

      {cameraScanOpen ? (
        <AppModalOverlay className="z-[90] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-3xl bg-card p-4 shadow-2xl">
            <p className="text-lg font-black text-foreground">{t(lang, "posBarcodeSoon")}</p>
            <video ref={cameraVideoRef} className="mt-3 h-56 w-full rounded-2xl bg-black object-cover" />
            <p className="mt-2 text-xs font-semibold text-muted-foreground">{cameraScanStatus || "Point camera at barcode."}</p>
            <button
              type="button"
              className="mt-3 min-h-[48px] w-full rounded-2xl border-2 border-border bg-card py-3 text-sm font-black text-foreground"
              onClick={() => {
                void stopBarcodeSession();
                setCameraScanOpen(false);
              }}
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </AppModalOverlay>
      ) : null}

    </div>
    </ShiftSellGateway>
  );
}
