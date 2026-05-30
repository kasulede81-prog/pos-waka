import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ScanLine, Search, X } from "lucide-react";
import type { Language, LineInputMode, Product, SaleLine } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { VirtualizedProductGrid } from "../components/pos/VirtualizedProductGrid";
import { DiscountLineModal } from "../components/pos/DiscountLineModal";
import { ShiftCloseModal } from "../components/pos/ShiftCloseModal";
import { lineDiscountUgx } from "../lib/saleAdjustments";
import { PosPageScrollSpacer } from "../components/layout/posScrollSpacer";
import { PosScreenPortal } from "../components/layout/PosScreenPortal";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";
import { useVisualViewportInset } from "../hooks/useVisualViewportInset";
import { ProductLockedModal } from "../components/ProductLockedModal";
import { isProductPlanLocked, lockedProductIds } from "../lib/productPlanLock";
import { hapticSaleComplete, hapticTap, playSaleSuccessTone } from "../lib/nativeFeedback";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { useSubscription } from "../context/SubscriptionContext";
import { maxProductsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { scanTodaySalesHead } from "../lib/salesDayIndex";
import { useDeferredSales } from "../hooks/useDeferredSales";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  productMatchesCategoryFilter,
  productMatchesSellSearch,
  shelfIconFor,
} from "../lib/productCategories";
import { formatStockLabel, getPosSellPresets } from "../lib/sellingEngine";
import { computeDraftCartStats, computeDraftCheckoutTotals, draftLineQuantityStep, formatDraftLineQty } from "../lib/draftCart";
import { CartSaleDiscountModal } from "../components/pos/CartSaleDiscountModal";
import { DraftCartLineRow } from "../components/pos/DraftCartLineRow";
import { DraftCartSummary } from "../components/pos/DraftCartSummary";
import { QuantityEditModal } from "../components/pos/QuantityEditModal";
import { resolveReceiptBranding } from "../lib/receiptBranding";

const VIRTUAL_PRODUCT_THRESHOLD = 10;
const MAX_RECENT_SEARCHES = 4;
const MAX_RECENT_PRODUCTS = 14;
const MAX_FAVORITE_PRODUCTS = 20;

import {
  buildReceiptDisplayData,
  buildReceiptNumberForSale,
  buildSaleReceiptHtml,
  buildSaleReceiptText,
  printReceiptText,
} from "../lib/receiptPrint";
const SEARCH_ALIASES: Record<string, string[]> = {
  blueband: ["margarine"],
  margarine: ["blueband"],
  soda: ["coke", "coca cola", "pepsi", "fanta", "sprite", "mirinda", "soft drink"],
  sugar: ["kakira", "kinyara", "brown sugar", "sack"],
};

type PaymentMethod = "cash" | "atm" | "mobile_money" | "mixed" | "credit";

const POS_CHECKOUT_METHODS: PaymentMethod[] = ["cash", "atm", "mobile_money", "credit"];

type CheckoutAmountField = "cash" | "mobile";

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
            className="min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200 active:brightness-95 motion-reduce:active:brightness-100"
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
            className="min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200 active:brightness-95"
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
  const { snapshot } = useSubscription();
  const location = useLocation();
  const navigate = useNavigate();
  const products = usePosStore(useShallow((s) => s.products));
  const sales = useDeferredSales();
  const customers = usePosStore(useShallow((s) => s.customers));
  const preferences = usePosStore(
    useShallow((s) => ({
      kioskQuickSell: s.preferences.kioskQuickSell,
      hapticsOn: s.preferences.hapticsOn,
      saleSoundOn: s.preferences.saleSoundOn,
      shifts: s.preferences.shifts,
      posLocked: s.preferences.posLocked,
      posSellCategoryFilter: s.preferences.posSellCategoryFilter,
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
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const removeDraftLine = usePosStore((s) => s.removeDraftLine);
  const setDraftLineQuantity = usePosStore((s) => s.setDraftLineQuantity);
  const adjustDraftLineQuantity = usePosStore((s) => s.adjustDraftLineQuantity);
  const applyDraftLineDiscount = usePosStore((s) => s.applyDraftLineDiscount);
  const draftCartDiscountUgx = usePosStore((s) => s.draftCartDiscountUgx);
  const setDraftCartDiscount = usePosStore((s) => s.setDraftCartDiscount);
  const closeShiftWithCashCount = usePosStore((s) => s.closeShiftWithCashCount);
  const clearDraft = usePosStore((s) => s.clearDraft);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);
  const addCustomer = usePosStore((s) => s.addCustomer);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const quickSell = preferences.kioskQuickSell;
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
  const [inputMode, setInputMode] = useState<LineInputMode>("money");
  const [display, setDisplay] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const draftCartStats = useMemo(() => computeDraftCartStats(draftLines), [draftLines]);
  const checkoutTotals = useMemo(
    () => computeDraftCheckoutTotals(draftLines, draftCartDiscountUgx),
    [draftLines, draftCartDiscountUgx],
  );
  const draftPayable = checkoutTotals.payableUgx;
  const draftDiscountTotal = useMemo(() => draftLines.reduce((a, l) => a + lineDiscountUgx(l), 0), [draftLines]);
  const [qtyEditLine, setQtyEditLine] = useState<SaleLine | null>(null);
  const [cartSaleDiscountOpen, setCartSaleDiscountOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeShift = useMemo(
    () => (preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId) ?? null,
    [preferences.shifts, actor.userId],
  );
  const [discountLine, setDiscountLine] = useState<SaleLine | null>(null);
  const [shiftCloseOpen, setShiftCloseOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [mobileMoneyInput, setMobileMoneyInput] = useState("");
  const [checkoutAmountField, setCheckoutAmountField] = useState<CheckoutAmountField>("cash");
  const [saleCustomerId, setSaleCustomerId] = useState<string>("");
  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [saleCustomerPhone, setSaleCustomerPhone] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [firstSaleOpen, setFirstSaleOpen] = useState(false);
  const pendingReceiptSaleIdRef = useRef<string | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const [saleSuccessFlash, setSaleSuccessFlash] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const sellCategoryKey = preferences.posSellCategoryFilter ?? CATEGORY_FILTER_ALL;

  const sellCategoryOptions = useMemo(() => distinctTrimmedCategories(products), [products]);
  const sellHasUncategorized = useMemo(() => products.some((p) => !(p.category ?? "").trim()), [products]);

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

  const receiptBranding = useMemo(
    () => resolveReceiptBranding(usePosStore.getState().preferences),
    [
      preferences.shopDisplayName,
      preferences.shopAddressLine,
      preferences.shopPhoneE164,
      preferences.receiptPaperSize,
    ],
  );

  const receiptDisplay = useMemo(() => {
    if (!receiptSale) return null;
    const shopName = (preferences.shopDisplayName ?? "").trim() || "Waka POS";
    const receiptNumber = buildReceiptNumberForSale(receiptSale, sales);
    return buildReceiptDisplayData({
      shopName,
      shopAddress: preferences.shopAddressLine ?? null,
      shopPhone: preferences.shopPhoneE164 ?? null,
      customHeaderLines: receiptBranding.customHeaderLines,
      cashier: receiptCashierLabel(receiptSale),
      receiptNumber,
      sale: receiptSale,
      productById,
      footerThanks: receiptBranding.footerThanks,
      footerPowered: "Powered by Waka POS",
      returnPolicy: receiptBranding.returnPolicy,
    });
  }, [
    receiptSale,
    preferences.shopDisplayName,
    preferences.shopAddressLine,
    preferences.shopPhoneE164,
    receiptBranding,
    sales,
    productById,
    receiptCashierLabel,
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
      footerPowered: receiptDisplay.footerPowered,
      returnPolicy: receiptDisplay.returnPolicy,
      customerName: cust?.name ?? null,
      customerBalanceUgx: cust ? cust.debtBalanceUgx : null,
      labels: {
        cashier: t(lang, "receiptCashier"),
        items: t(lang, "receiptItemsLabel"),
        total: t(lang, "receiptTotalLabel"),
        paid: t(lang, "receiptPaidLabel"),
        debtSale: t(lang, "receiptDebtLine"),
        balance: t(lang, "receiptBalanceLine"),
        time: t(lang, "receiptTimeLabel"),
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
    const aliasSet = new Set<string>();
    if (qLower && SEARCH_ALIASES[qLower]) {
      for (const a of SEARCH_ALIASES[qLower]) aliasSet.add(a);
    }
    for (const tok of qLower.split(/\s+/).filter(Boolean)) {
      const al = SEARCH_ALIASES[tok];
      if (al) for (const x of al) aliasSet.add(x);
    }
    return { q, aliasTerms: [...aliasSet] };
  }, [searchQuery]);

  const sellRowMatchesSearch = useMemo(() => {
    const { q, aliasTerms } = sellSearchContext;
    if (!q) return () => true;
    return (p: Product) => productMatchesSellSearch(p, q, aliasTerms);
  }, [sellSearchContext]);

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
    return products.filter((p) => {
      if (!q) return productMatchesCategoryFilter(p, sellCategoryKey);
      if (!productMatchesSellSearch(p, q, aliasTerms)) return false;
      if (sellCategoryKey === CATEGORY_FILTER_ALL) return true;
      return productMatchesCategoryFilter(p, sellCategoryKey);
    }).sort((a, b) => {
      const favA = favoriteIdSet.has(a.id) ? 0 : 1;
      const favB = favoriteIdSet.has(b.id) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [products, sellSearchContext, sellCategoryKey, favoriteIdSet]);

  const shelfCards = useMemo(() => {
    const categoryCounts = new Map<string, number>();
    let uncategorizedCount = 0;
    for (const p of products) {
      const cat = (p.category ?? "").trim();
      if (!cat) {
        uncategorizedCount += 1;
      } else {
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }
    }
    const cards = sellCategoryOptions.map((cat) => ({
      key: cat,
      label: cat,
      count: categoryCounts.get(cat) ?? 0,
      icon: shelfIconFor(cat),
    }));
    if (sellHasUncategorized) {
      cards.push({
        key: UNCATEGORIZED_SENTINEL,
        label: t(lang, "posNoShelf"),
        count: uncategorizedCount,
        icon: null,
      });
    }
    return cards;
  }, [products, sellCategoryOptions, sellHasUncategorized, lang]);

  const showShelfBoxes =
    products.length > 0 && sellCategoryKey === CATEGORY_FILTER_ALL && sellSearchContext.q.length === 0;
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
        setDraftInput({ product: p, inputMode: mode, value });
        const res = addDraftLineFromInput();
        if (!res.ok) {
          setToast(t(lang, res.errorKey ?? "saleError"));
          window.setTimeout(() => setToast(null), 2200);
          return;
        }
        bumpRecentProduct(p.id);
        if (hapticsOn) void hapticTap();
        setSaleCheckoutMinimized(true);
        setToast(t(lang, "posAddedToCart"));
        window.setTimeout(() => setToast(null), 1200);
        searchInputRef.current?.focus();
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
    [addDraftLineFromInput, bumpRecentProduct, hapticsOn, lang, lockedIds, setDraftInput],
  );

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
      setSaleCheckoutMinimized(true);
      if (opts?.closeSheet !== false) {
        setSheetOpen(false);
        setSelected(null);
      }
      setToast(t(lang, "posAddedToCart"));
      window.setTimeout(() => setToast(null), 1200);
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    },
    [bumpRecentProduct, hapticsOn, setDraftInput, lang],
  );

  const applyDraftInput = useCallback(() => {
    if (!selected) return;
    const val = inputMode === "money" ? parseDisplayMoney(display) : parseDisplayQty(display);
    setDraftInput({ product: selected, inputMode, value: val });
    const res = addDraftLineFromInput();
    if (!res.ok) {
      setToast(t(lang, res.errorKey ?? "saleError"));
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    afterAddToCart(selected.id);
  }, [selected, inputMode, display, setDraftInput, addDraftLineFromInput, lang, afterAddToCart]);

  const applyPreset = useCallback(
    (mode: LineInputMode, value: number) => {
      if (!selected) return;
      setDraftInput({ product: selected, inputMode: mode, value });
      const res = addDraftLineFromInput();
      if (!res.ok) {
        setToast(t(lang, res.errorKey ?? "saleError"));
        window.setTimeout(() => setToast(null), 2200);
        return;
      }
      afterAddToCart(selected.id);
    },
    [selected, setDraftInput, addDraftLineFromInput, lang, afterAddToCart],
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

  const appendCheckoutDigit = useCallback(
    (d: string) => {
      const apply = (prev: string) => {
        if (d === "back") return prev.slice(0, -1);
        return (prev + d).replace(/\D/g, "").slice(0, 10);
      };
      if (checkoutAmountField === "mobile") setMobileMoneyInput(apply);
      else setCashInput(apply);
    },
    [checkoutAmountField],
  );

  const clearCheckoutAmount = useCallback(() => {
    if (checkoutAmountField === "mobile") setMobileMoneyInput("");
    else setCashInput("");
  }, [checkoutAmountField]);

  const commitSearch = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setRecentSearches((prev) => [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES));
  }, []);

  const finishSale = useCallback(() => {
    if (paymentMethod === "cash" && parseDisplayMoney(cashInput) > 0 && parseDisplayMoney(cashInput) < draftPayable) {
      setToast(t(lang, "paymentCashTooLow"));
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    const debt = paymentMethod === "credit" || paymentMethod === "mixed" ? computedDebt : 0;
    let customerId = saleCustomerId || null;
    if (debt > 0 && !customerId && saleCustomerName.trim()) {
      const created = addCustomer({
        name: saleCustomerName.trim(),
        phone: saleCustomerPhone.trim(),
        location: "Uganda",
      });
      customerId = created.id;
    }
    const r = finalizeDraftSale({
      debtUgx: debt,
      customerId,
      paymentMethod,
      amountPaidUgx: totalPaidInput,
      changeGivenUgx: changeDue,
    });
    if (!r.ok) {
      setToast(t(lang, r.errorKey ?? "saleError"));
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    if (hapticsOn) void hapticSaleComplete();
    if (soundOn) playSaleSuccessTone();

    setCashInput("");
    setMobileMoneyInput("");
    setSaleCustomerId("");
    setSaleCustomerName("");
    setSaleCustomerPhone("");
    setCheckoutAmountField("cash");
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
      setToast(t(lang, "saleSaved"));
      window.setTimeout(() => setToast(null), 1600);
    }
  }, [
    paymentMethod,
    cashInput,
    draftPayable,
    computedDebt,
    saleCustomerId,
    saleCustomerName,
    saleCustomerPhone,
    addCustomer,
    totalPaidInput,
    changeDue,
    finalizeDraftSale,
    lang,
    hapticsOn,
    soundOn,
    preferences.celebratedFirstSale,
  ]);

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

  const moneyPresets = selected?.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = selected?.quickPresetsQty?.filter((x) => x > 0) ?? [];
  const sellPresets = selected ? getPosSellPresets(selected) : [];
  const keyboardInset = useVisualViewportInset();

  if (!hasPermission(actor.role, "pos.sell")) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-950">{t(lang, "sellTitle")}</h2>
          {quickSell ? <p className="text-sm font-black text-waka-800">{t(lang, "quickSellBadge")}</p> : null}
        </div>
        {draftLines.length > 0 && (
          <button
            type="button"
            onClick={() => clearDraft()}
            className="min-h-[48px] rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm active:bg-slate-50"
          >
            {t(lang, "clearSale")}
          </button>
        )}
        {activeShift ? (
          <button
            type="button"
            onClick={() => setShiftCloseOpen(true)}
            className="min-h-[48px] rounded-full border border-waka-300 bg-waka-50 px-4 py-2 text-sm font-black text-waka-900 shadow-sm active:bg-waka-100"
          >
            {t(lang, "shiftCloseBtn")}
          </button>
        ) : null}
      </div>

      {lockedProductCount > 0 ? (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-950">
          {t(lang, "freePlanLockedProductsNotice")
            .replace("{{locked}}", String(lockedProductCount))
            .replace("{{limit}}", String(productLimit ?? 10))}
        </div>
      ) : null}

      {products.length > 0 ? (
        <div className="space-y-2 rounded-[1.35rem] border border-stone-200 bg-white p-2.5 shadow-waka-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={(e) => commitSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSearch(searchQuery);
              }}
              placeholder={t(lang, "posSellSearchPlaceholder")}
              aria-label={t(lang, "posSellSearchPlaceholder")}
              className="h-11 w-full rounded-2xl border border-stone-200 bg-stone-50/90 pl-9 pr-10 text-base font-semibold text-stone-900 outline-none ring-waka-200 placeholder:text-stone-400 focus:border-waka-400 focus:bg-white focus:ring-1"
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-stone-500 active:bg-stone-100"
              onClick={() => {
                if (searchQuery.trim()) setSearchQuery("");
              }}
              aria-label={searchQuery.trim() ? t(lang, "posClearSearch") : t(lang, "posBarcodeSoon")}
            >
              {searchQuery.trim() ? <X className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
            </button>
          </div>
          {recentSearches.length > 0 ? (
            <ul
              className="m-0 flex max-w-full list-none gap-1 overflow-x-auto p-0 pb-0.5"
              aria-label={t(lang, "posRecentSearches")}
            >
              {recentSearches.map((item) => (
                <li key={item} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setSearchQuery(item)}
                    className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-semibold text-stone-700 active:bg-stone-100"
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {frequentTodayVisible.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posFrequentToday")}</p>
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
          {favoriteProductsVisible.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posFavorites")}</p>
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
          {recentProductsVisible.length > 0 ? (
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posRecentProducts")}</p>
              <div className="mt-1 flex max-w-full gap-1 overflow-x-auto pb-0.5">
                {recentProductsVisible.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openProduct(p)}
                      className="shrink-0 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-semibold text-stone-800 active:bg-stone-100"
                    >
                      {p.name}
                    </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {products.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-2xl font-black text-slate-900">{t(lang, "posEmptyTitle")}</p>
          <p className="mt-2 text-lg text-slate-600">{t(lang, "posEmptySub")}</p>
          {hasPermission(actor.role, "products.add") ? (
            <Link
              to="/stock"
              className="mt-6 inline-flex min-h-[56px] items-center justify-center rounded-3xl bg-waka-600 px-8 py-4 text-xl font-black text-white shadow-lg active:bg-waka-700"
            >
              {t(lang, "posEmptyCtaProducts")}
            </Link>
          ) : (
            <p className="mt-4 text-base font-semibold text-stone-600">{t(lang, "posEmptyAskOwner")}</p>
          )}
        </section>
      ) : showShelfBoxes ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
                {t(lang, "posSellCategoryHeading")}
              </p>
              <p className="text-sm font-bold text-stone-600">{t(lang, "posShelvesHint")}</p>
            </div>
            <p className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">
              {products.length}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {shelfCards.map((shelf) => (
              <button
                key={shelf.key}
                type="button"
                onClick={() => setSellCategoryFilter(shelf.key)}
                className="min-h-[116px] rounded-[1.35rem] border border-slate-200 bg-white p-3 text-left shadow-sm active:border-waka-400 active:bg-waka-50"
              >
                <span className="flex h-full flex-col justify-between">
                  <span>
                    <span className="text-2xl" aria-hidden>
                      {shelf.icon ?? "▣"}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-lg font-black leading-tight text-slate-950">
                      {shelf.label}
                    </span>
                  </span>
                  <span className="text-xs font-bold text-stone-500">
                    {t(lang, "posShelfProductCount").replace("{{count}}", String(shelf.count))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : filteredProducts.length === 0 ? (
        <section className="space-y-2">
          {hasSellViewFilter ? (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-[1.35rem] border border-waka-200 bg-white/95 px-2.5 py-2 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={clearSellView}
                className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden />
                {t(lang, "posBackToShelves")}
              </button>
              <p className="min-w-0 flex-1 truncate text-right text-sm font-black text-slate-900">
                {sellSearchContext.q ? t(lang, "posSearchResults") : selectedShelfLabel}
              </p>
            </div>
          ) : null}
          <p className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-lg font-bold text-amber-950">{t(lang, "posSellNoMatch")}</p>
        </section>
      ) : (
        <section className="space-y-2">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-[1.35rem] border border-waka-200 bg-white/95 px-2.5 py-2 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={clearSellView}
              className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl bg-waka-600 px-4 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
              {t(lang, "posBackToShelves")}
            </button>
            <p className="min-w-0 flex-1 truncate text-right text-sm font-black text-slate-900">
              {sellCategoryKey !== CATEGORY_FILTER_ALL && shelfIconFor(selectedShelfLabel) ? (
                <span className="mr-1" aria-hidden>
                  {shelfIconFor(selectedShelfLabel)}
                </span>
              ) : null}
              {sellSearchContext.q ? t(lang, "posSearchResults") : selectedShelfLabel}
            </p>
          </div>
          {filteredProducts.length > VIRTUAL_PRODUCT_THRESHOLD ? (
            <VirtualizedProductGrid
              products={filteredProducts}
              onPick={openProduct}
              stockLabel={t(lang, "stockLabel")}
              noShelfLabel={t(lang, "posNoShelf")}
              isLocked={(p) => isProductPlanLocked(p.id, lockedIds)}
              lockedBadge={t(lang, "productLockedBadge")}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {filteredProducts.map((p) => {
                const locked = isProductPlanLocked(p.id, lockedIds);
                return (
                <article
                  key={p.id}
                  className={clsx(
                    "relative flex min-h-[132px] flex-col justify-between rounded-[1.35rem] border p-3 pt-10 text-left shadow-sm",
                    locked
                      ? "border-stone-200/80 bg-stone-50/90 opacity-55"
                      : "border-slate-200 bg-white active:border-waka-400",
                  )}
                  style={{ contentVisibility: "auto" }}
                >
                  {locked ? (
                    <span className="absolute left-2.5 top-2.5 rounded-full bg-stone-800/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                      {t(lang, "productLockedBadge")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-base shadow-sm active:bg-stone-50"
                      aria-label={favoriteIdSet.has(p.id) ? t(lang, "posRemoveFavorite") : t(lang, "posToggleFavorite")}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavoriteProduct(p.id);
                    }}
                  >
                    {favoriteIdSet.has(p.id) ? "★" : "☆"}
                  </button>
                  <button type="button" onClick={() => openProduct(p)} className="text-left">
                    <p className="line-clamp-2 pr-7 text-base font-black leading-tight text-slate-950">{p.name}</p>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-stone-500">
                      {shelfIconFor(p.category ?? "") ? <span className="mr-1" aria-hidden>{shelfIconFor(p.category ?? "")}</span> : null}
                      {(p.category ?? "").trim() ? p.category.trim() : t(lang, "posNoShelf")}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs font-bold leading-snug text-slate-600">
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
                      "mt-2 min-h-[38px] rounded-2xl px-3 py-2 text-base font-black",
                      locked
                        ? "border-2 border-stone-300 bg-stone-200 text-stone-600"
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
      )}

      {draftLines.length > 0 && !saleCheckoutMinimized ? (
        <PosScreenPortal>
        <div
          className="waka-overlay-full fixed inset-0 z-[80] flex min-h-0 flex-col bg-waka-50 pt-[env(safe-area-inset-top,0px)]"
          style={{
            paddingBottom: keyboardInset > 0 ? keyboardInset : "env(safe-area-inset-bottom, 0px)",
          }}
          role="dialog"
          aria-modal
          aria-labelledby="pos-checkout-title"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-waka-200 bg-waka-50 px-3 py-3">
            <button
              type="button"
              onClick={() => clearDraft()}
              className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm active:bg-slate-50"
            >
              {t(lang, "clearSale")}
            </button>
            <h2 id="pos-checkout-title" className="min-w-0 flex-1 truncate text-center text-lg font-black text-waka-950">
              {t(lang, "thisSale")}
            </h2>
            <button
              type="button"
              onClick={() => setSaleCheckoutMinimized(true)}
              className="shrink-0 rounded-full border border-waka-300 bg-white px-3 py-2 text-sm font-bold text-waka-900 shadow-sm active:bg-waka-50"
            >
              {t(lang, "posAddMoreItems")}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch]">
            <DraftCartSummary lang={lang} stats={draftCartStats} />
            <ul className="mt-3 space-y-2 rounded-2xl border border-waka-200 bg-white p-3 shadow-sm">
              {draftLines.map((line) => (
                <DraftCartLineRow
                  key={line.productId}
                  lang={lang}
                  line={line}
                  product={productById.get(line.productId)}
                  onIncrement={() => handleDraftQtyStep(line, false)}
                  onDecrement={() => handleDraftQtyStep(line, true)}
                  onQtyTap={() => setQtyEditLine(line)}
                  onDiscount={() => setDiscountLine(line)}
                  onRemove={() => removeDraftLine(line.productId)}
                />
              ))}
            </ul>
            {draftDiscountTotal > 0 ? (
              <p className="mt-2 text-sm font-bold text-amber-800">
                {t(lang, "ownerDiscountsToday")}: UGX {draftDiscountTotal.toLocaleString()}
              </p>
            ) : null}
            <div className="mt-4 rounded-2xl border border-waka-200 bg-waka-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-800">{t(lang, "cartDiscountApplied")}</p>
                <button
                  type="button"
                  onClick={() => setCartSaleDiscountOpen(true)}
                  className="min-h-[44px] shrink-0 rounded-2xl border-2 border-waka-400 bg-white px-4 text-sm font-black text-waka-900 active:bg-waka-100"
                >
                  {t(lang, "cartDiscountBtn")}
                </button>
              </div>
              {checkoutTotals.cartDiscountUgx > 0 ? (
                <p className="mt-2 text-sm font-bold text-emerald-900">
                  − UGX {checkoutTotals.cartDiscountUgx.toLocaleString()}
                </p>
              ) : null}
            </div>
            {checkoutTotals.cartDiscountUgx > 0 ? (
              <p className="mt-3 text-sm font-semibold text-slate-600">
                {t(lang, "cartDiscountOriginal")}: UGX {checkoutTotals.lineSubtotalUgx.toLocaleString()}
              </p>
            ) : null}
            <p className="mt-4 text-3xl font-black text-slate-900">
              {checkoutTotals.cartDiscountUgx > 0 ? t(lang, "payableTotalLabel") : t(lang, "totalLabel")}{" "}
              <span className="text-waka-700">UGX {draftPayable.toLocaleString()}</span>
            </p>

            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "paymentMethodLabel")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {POS_CHECKOUT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(method);
                      if (method === "cash" || method === "credit") setCheckoutAmountField("cash");
                    }}
                    className={clsx(
                      "min-h-[48px] rounded-2xl border text-sm font-black",
                      paymentMethod === method ? "border-waka-400 bg-waka-100 text-waka-950" : "border-stone-200 bg-white text-stone-700",
                    )}
                  >
                    {t(lang, `paymentMethod_${method}`)}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "cash" || paymentMethod === "credit" ? (
              <div className="mt-4">
                <p className="text-base font-semibold text-slate-800">
                  {paymentMethod === "cash" ? t(lang, "paymentCashReceivedLabel") : t(lang, "paymentCashLabel")}
                </p>
                <button
                  type="button"
                  onClick={() => setCheckoutAmountField("cash")}
                  className={clsx(
                    "mt-2 flex min-h-[52px] w-full items-center justify-end rounded-2xl border-2 px-4 py-3 text-xl font-black",
                    checkoutAmountField === "cash" ? "border-waka-500 bg-waka-50 text-slate-900" : "border-slate-200 bg-white text-slate-900",
                  )}
                >
                  UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </button>
              </div>
            ) : null}

            {paymentMethod === "credit" ? (
              <div className="mt-4">
                <p className="text-base font-semibold text-slate-800">{t(lang, "paymentMobileMoneyLabel")}</p>
                <button
                  type="button"
                  onClick={() => setCheckoutAmountField("mobile")}
                  className={clsx(
                    "mt-2 flex min-h-[52px] w-full items-center justify-end rounded-2xl border-2 px-4 py-3 text-xl font-black",
                    checkoutAmountField === "mobile" ? "border-waka-500 bg-waka-50 text-slate-900" : "border-slate-200 bg-white text-slate-900",
                  )}
                >
                  UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </button>
              </div>
            ) : null}

            {(paymentMethod === "cash" || paymentMethod === "credit") && (
              <div className="mt-4">
                <Numpad allowDecimal={false} onDigit={appendCheckoutDigit} onClear={clearCheckoutAmount} />
              </div>
            )}

            {(paymentMethod === "cash" || paymentMethod === "credit") && (cashInput || changeDue > 0) ? (
              <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-base font-black text-emerald-900">
                {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
              </p>
            ) : null}

            {paymentMethod === "credit" ? (
              <>
                <p className="mt-3 rounded-xl bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
                  {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-base font-semibold text-slate-800">
                    {t(lang, "paymentDebtNameLabel")}
                    <input
                      value={saleCustomerName}
                      onChange={(e) => setSaleCustomerName(e.target.value)}
                      className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold"
                      placeholder={t(lang, "paymentDebtNamePlaceholder")}
                    />
                  </label>
                  <label className="block text-base font-semibold text-slate-800">
                    {t(lang, "paymentDebtPhoneLabel")}
                    <input
                      value={saleCustomerPhone}
                      onChange={(e) => setSaleCustomerPhone(e.target.value)}
                      className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold"
                      placeholder={t(lang, "personPhonePh")}
                      inputMode="tel"
                    />
                  </label>
                </div>
                {customers.length > 0 ? (
                  <label className="mt-4 block text-base font-semibold text-slate-800">
                    {t(lang, "paymentPickExistingDebt")}
                    <select
                      value={saleCustomerId}
                      onChange={(e) => setSaleCustomerId(e.target.value)}
                      className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-lg font-medium"
                    >
                      <option value="">{t(lang, "paymentNoNamedCustomer")}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.debtBalanceUgx > 0 ? ` — ${t(lang, "debtBalanceShort")} UGX ${c.debtBalanceUgx.toLocaleString()}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            <div aria-hidden className="h-4 shrink-0" />
          </div>
          <footer className="shrink-0 border-t border-waka-200 bg-waka-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
            <button
              type="button"
              onClick={finishSale}
              className="min-h-[56px] w-full rounded-3xl bg-waka-600 py-4 text-2xl font-black text-white shadow-lg active:bg-waka-700"
            >
              {t(lang, "saveSale")}
            </button>
          </footer>
        </div>
        </PosScreenPortal>
      ) : null}

      {draftLines.length > 0 && saleCheckoutMinimized ? (
        <div className="fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom))] left-0 right-0 z-[48] border-t border-waka-200 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <div className="min-w-0">
              <DraftCartSummary lang={lang} stats={draftCartStats} compact />
              <p className="truncate text-xl font-black text-waka-700">UGX {draftPayable.toLocaleString()}</p>
            </div>
            <button
              type="button"
              onClick={() => setSaleCheckoutMinimized(false)}
              className="shrink-0 rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white shadow-md active:bg-waka-700"
            >
              {t(lang, "posReviewPay")}
            </button>
          </div>
        </div>
      ) : null}

      {sheetOpen && selected && (
        <div
          className="fixed inset-0 z-[52] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top,0px)]"
          style={{
            paddingBottom:
              keyboardInset > 0 ? keyboardInset : "env(safe-area-inset-bottom, 0px)",
          }}
          role="dialog"
          aria-modal
          aria-labelledby="pos-add-sheet-title"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-3 py-3">
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="min-h-[48px] shrink-0 rounded-2xl border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 active:bg-slate-50"
            >
              {t(lang, "cancel")}
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p id="pos-add-sheet-title" className="truncate text-xl font-black text-slate-900">
                {selected.name}
              </p>
              <p className="truncate text-sm font-semibold text-slate-500">{formatProductPriceLabel(selected)}</p>
              <p className="truncate text-xs font-bold text-slate-600">{formatStockLabel(selected)}</p>
            </div>
            <span className="min-h-[48px] w-[5.5rem] shrink-0" aria-hidden />
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 pb-4 [-webkit-overflow-scrolling:touch]">
            {(sellPresets.length > 0 || moneyPresets.length > 0 || qtyPresets.length > 0) && (
              <div className="space-y-3">
                <p className="text-center text-sm font-bold uppercase tracking-wide text-slate-500">
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
                className="mt-6 min-h-[52px] w-full rounded-2xl border-2 border-dashed border-slate-300 py-4 text-lg font-bold text-slate-600 active:bg-slate-50"
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
                      inputMode === "money" ? "bg-waka-600 text-white" : "bg-slate-100 text-slate-700",
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
                      inputMode === "quantity" ? "bg-waka-600 text-white" : "bg-slate-100 text-slate-700",
                    )}
                  >
                    {t(lang, "qtyTab")}
                  </button>
                </div>

                <div className="mt-4 min-h-[76px] rounded-2xl bg-slate-100 px-4 py-4 text-right text-5xl font-black tracking-tight text-slate-900">
                  {display || "0"}
                  <span className="ml-2 text-xl font-bold text-slate-500">{inputMode === "money" ? "UGX" : selected.baseUnit}</span>
                </div>

                <div className="mt-4">
                  <Numpad allowDecimal={inputMode === "quantity"} onDigit={appendDigit} onClear={() => setDisplay("")} />
                </div>

              </>
            )}
            </div>
            <div className="shrink-0 border-t border-slate-100 bg-white p-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
              {quickSell && !showAdvanced ? null : (
                <button
                  type="button"
                  onClick={applyDraftInput}
                  className="min-h-[56px] w-full rounded-2xl bg-slate-900 py-4 text-lg font-black text-white active:bg-slate-800"
                >
                  {t(lang, "addToSale")}
                </button>
              )}
            </div>
          </div>
        </div>
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
          className="fixed inset-0 z-[80] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
          role="dialog"
          aria-modal
          aria-labelledby="pos-receipt-title"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <h2 id="pos-receipt-title" className="text-xl font-black text-slate-900">
              {t(lang, "receiptTitle")}
            </h2>
            <button
              type="button"
              onClick={() => setReceiptSaleId(null)}
              className="min-h-[44px] rounded-xl border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 active:bg-slate-50"
            >
              {t(lang, "receiptClose")}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[#f8fafc] px-4 py-4 pb-6 [-webkit-overflow-scrolling:touch]">
            <div
              className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              dangerouslySetInnerHTML={{ __html: receiptHtmlPreview }}
            />
          </div>
          <footer className="shrink-0 border-t border-slate-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                className="min-h-[52px] rounded-2xl bg-slate-900 py-3 text-sm font-black text-white active:bg-slate-800"
                onClick={() => {
                  const ok = printReceiptText(receiptPlain, preferences.receiptPaperSize ?? "80mm");
                  if (!ok) window.alert(t(lang, "receiptPrintBlocked"));
                }}
              >
                {t(lang, "receiptPrint")}
              </button>
              <button
                type="button"
                className="min-h-[52px] rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white active:bg-emerald-700"
                onClick={async () => {
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: "Waka POS Receipt", text: receiptPlain });
                      return;
                    } catch {
                      // fallback below
                    }
                  }
                  window.open(`https://wa.me/?text=${encodeURIComponent(receiptPlain)}`, "_blank", "noopener,noreferrer");
                }}
              >
                Share
              </button>
              <button
                type="button"
                className="min-h-[52px] rounded-2xl bg-waka-600 py-3 text-sm font-black text-white active:bg-waka-700"
                onClick={() => setReceiptSaleId(null)}
              >
                {t(lang, "receiptClose")}
              </button>
            </div>
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
            setToast(t(lang, "saleError"));
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
        onApply={(discountUgx) => setDraftCartDiscount(discountUgx)}
      />

      <ShiftCloseModal
        lang={lang}
        open={shiftCloseOpen}
        shift={activeShift}
        onClose={() => setShiftCloseOpen(false)}
        onConfirm={(counted) => {
          const r = closeShiftWithCashCount(counted);
          if (!r.ok) {
            setToast(t(lang, "saleError"));
            window.setTimeout(() => setToast(null), 2200);
            return { ok: false };
          }
          setToast(t(lang, "shiftCloseConfirm"));
          window.setTimeout(() => setToast(null), 2200);
          return { ok: true };
        }}
      />

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

      <ProductLockedModal lang={lang} open={productLockedOpen} onClose={() => setProductLockedOpen(false)} />

      {toast && (
        <div className="fixed bottom-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+0.5rem)] left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-2xl bg-slate-900 px-5 py-4 text-center text-base font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}

      {firstSaleOpen ? (
        <AppModalOverlay className="z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
          <div className="max-w-md rounded-[2rem] bg-gradient-to-b from-amber-100 to-white p-8 text-center shadow-2xl">
            <p className="text-4xl" aria-hidden>
              🎉
            </p>
            <p className="mt-4 text-3xl font-black text-slate-900">{t(lang, "firstSaleTitle")}</p>
            <p className="mt-3 text-lg text-slate-700">{t(lang, "firstSaleBody")}</p>
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
                className="min-h-[52px] w-full rounded-2xl border-2 border-slate-300 py-4 text-lg font-bold text-slate-800 active:bg-slate-50"
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

      <PosPageScrollSpacer minimizedCheckout={draftLines.length > 0 && saleCheckoutMinimized} />
    </div>
  );
}
