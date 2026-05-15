import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import type { Language, LineInputMode, Product, Sale } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { VirtualizedProductGrid } from "../components/pos/VirtualizedProductGrid";
import { hapticSaleComplete, hapticTap, playSaleSuccessTone } from "../lib/nativeFeedback";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala } from "../lib/datesUg";
import {
  CATEGORY_FILTER_ALL,
  UNCATEGORIZED_SENTINEL,
  distinctTrimmedCategories,
  productMatchesCategoryFilter,
  productMatchesSellSearch,
} from "../lib/productCategories";

const VIRTUAL_PRODUCT_THRESHOLD = 16;
const MAX_RECENT_SEARCHES = 4;
const MAX_RECENT_PRODUCTS = 14;
const MAX_FAVORITE_PRODUCTS = 20;

function buildSaleReceiptText(params: {
  shopName: string;
  cashier: string;
  sale: Sale;
  customerName: string | null;
  customerBalanceUgx: number | null;
  labels: {
    cashier: string;
    items: string;
    total: string;
    paid: string;
    debtSale: string;
    balance: string;
    time: string;
  };
}): string {
  const { shopName, cashier, sale, customerName, customerBalanceUgx, labels } = params;
  const lines: string[] = [];
  lines.push(shopName);
  lines.push("");
  lines.push(`${labels.cashier}: ${cashier}`);
  lines.push(`${labels.time}: ${new Date(sale.createdAt).toLocaleString()}`);
  lines.push("");
  lines.push(labels.items);
  for (const ln of sale.lines) {
    const q =
      ln.inputMode === "money"
        ? `${ln.name} (${(ln.moneyAmountUgx ?? ln.lineTotalUgx).toLocaleString()} UGX)`
        : `${ln.name} × ${ln.quantity}`;
    lines.push(`· ${q}  →  UGX ${ln.lineTotalUgx.toLocaleString()}`);
  }
  lines.push("");
  lines.push(`${labels.total}: UGX ${sale.totalUgx.toLocaleString()}`);
  lines.push(`${labels.paid}: UGX ${sale.cashPaidUgx.toLocaleString()}`);
  if (sale.debtUgx > 0) {
    lines.push(`${labels.debtSale}: UGX ${sale.debtUgx.toLocaleString()}`);
    if (customerName) lines.push(`${labels.balance} (${customerName}): UGX ${(customerBalanceUgx ?? 0).toLocaleString()}`);
    else lines.push(`${labels.balance}: UGX ${(customerBalanceUgx ?? 0).toLocaleString()}`);
  }
  lines.push("");
  lines.push("—");
  lines.push("Waka POS");
  return lines.join("\n");
}
const SEARCH_ALIASES: Record<string, string[]> = {
  blueband: ["margarine"],
  margarine: ["blueband"],
  soda: ["coke", "coca cola", "pepsi", "fanta", "sprite", "mirinda", "soft drink"],
  sugar: ["kakira", "kinyara", "brown sugar", "sack"],
};

type PaymentMethod = "cash" | "mobile_money" | "mixed" | "credit";

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
  const location = useLocation();
  const navigate = useNavigate();
  const products = usePosStore((s) => s.products);
  const sales = usePosStore((s) => s.sales);
  const customers = usePosStore((s) => s.customers);
  const preferences = usePosStore((s) => s.preferences);
  const draftLines = usePosStore((s) => s.draftLines);
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const removeDraftLine = usePosStore((s) => s.removeDraftLine);
  const clearDraft = usePosStore((s) => s.clearDraft);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);
  const addCustomer = usePosStore((s) => s.addCustomer);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const quickSell = preferences.kioskQuickSell;
  const hapticsOn = preferences.hapticsOn !== false;
  const soundOn = preferences.saleSoundOn !== false;

  const [sheetOpen, setSheetOpen] = useState(false);
  /** When true, checkout is a slim bar so the user can scroll the product list again. */
  const [saleCheckoutMinimized, setSaleCheckoutMinimized] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [inputMode, setInputMode] = useState<LineInputMode>("money");
  const [display, setDisplay] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const draftTotal = useMemo(() => draftLines.reduce((a, l) => a + l.lineTotalUgx, 0), [draftLines]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [mobileMoneyInput, setMobileMoneyInput] = useState("");
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

  const soldTodayByProduct = useMemo(() => {
    const todayKey = dateKeyKampala(new Date());
    const byProduct = new Map<string, number>();
    for (const sale of sales) {
      if (dateKeyKampala(sale.createdAt) !== todayKey) continue;
      for (const line of sale.lines) {
        byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity);
      }
    }
    return byProduct;
  }, [sales]);

  const favoriteIds = preferences.favoriteProductIds ?? [];
  const recentIds = preferences.recentProductIds ?? [];

  const favoriteProducts = useMemo(
    () =>
      favoriteIds
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is Product => p != null && productMatchesCategoryFilter(p, sellCategoryKey)),
    [favoriteIds, products, sellCategoryKey],
  );

  const recentProducts = useMemo(() => {
    const out: Product[] = [];
    for (const id of recentIds) {
      const p = products.find((x) => x.id === id);
      if (p && productMatchesCategoryFilter(p, sellCategoryKey)) out.push(p);
    }
    return out.slice(0, 8);
  }, [recentIds, products, sellCategoryKey]);

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

  const receiptPlain = useMemo(() => {
    if (!receiptSale) return "";
    const shopName = (preferences.shopDisplayName ?? "").trim() || "Waka POS";
    const cashier = (actor.displayName ?? actor.userId).trim();
    const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
    return buildSaleReceiptText({
      shopName,
      cashier,
      sale: receiptSale,
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
  }, [receiptSale, preferences.shopDisplayName, actor.displayName, actor.userId, customers, lang]);

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
    });
  }, [products, sellSearchContext, sellCategoryKey]);

  const openProduct = useCallback((p: Product) => {
    setSelected(p);
    setInputMode("money");
    setDisplay("");
    const hasPresets =
      (p.quickPresetsMoneyUgx?.filter((x) => x > 0).length ?? 0) > 0 ||
      ((p.quickPresetsQty?.filter((x) => x > 0).length ?? 0) > 0);
    const pref = usePosStore.getState().preferences;
    setShowAdvanced(!pref.kioskQuickSell || !hasPresets);
    setDraftInput(null);
    setSheetOpen(true);
  }, [setDraftInput]);

  useEffect(() => {
    if (draftLines.length === 0) setSaleCheckoutMinimized(false);
  }, [draftLines.length]);

  useEffect(() => {
    const id = (location.state as { preferProductId?: string } | null)?.preferProductId;
    if (!id || !products.length) return;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    openProduct(p);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.key, location.pathname, products, openProduct, navigate]);

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
    if (selected) bumpRecentProduct(selected.id);
    if (hapticsOn) void hapticTap();
    setSheetOpen(false);
    setSelected(null);
    setDisplay("");
    setSaleCheckoutMinimized(false);
  }, [selected, inputMode, display, setDraftInput, addDraftLineFromInput, lang, hapticsOn, bumpRecentProduct]);

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
      if (selected) bumpRecentProduct(selected.id);
      if (hapticsOn) void hapticTap();
      setSheetOpen(false);
      setSelected(null);
      setDisplay("");
      setSaleCheckoutMinimized(false);
    },
    [selected, setDraftInput, addDraftLineFromInput, lang, hapticsOn, bumpRecentProduct],
  );

  const totalPaidInput = useMemo(() => {
    const cash = parseDisplayMoney(cashInput);
    const mobile = parseDisplayMoney(mobileMoneyInput);
    if (paymentMethod === "cash") return draftTotal;
    if (paymentMethod === "mobile_money") return draftTotal;
    if (paymentMethod === "credit") return cash + mobile;
    return cash + mobile;
  }, [paymentMethod, cashInput, mobileMoneyInput, draftTotal]);

  const computedDebt = useMemo(() => {
    if (paymentMethod === "cash" || paymentMethod === "mobile_money") return 0;
    return Math.max(0, draftTotal - totalPaidInput);
  }, [paymentMethod, draftTotal, totalPaidInput]);

  const commitSearch = useCallback((raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setRecentSearches((prev) => [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES));
  }, []);

  const finishSale = useCallback(() => {
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
    computedDebt,
    saleCustomerId,
    saleCustomerName,
    saleCustomerPhone,
    addCustomer,
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

  if (!hasPermission(actor.role, "pos.sell")) {
    return <Navigate to="/" replace />;
  }

  return (
    <div
      className={clsx(
        "space-y-4",
        draftLines.length > 0 && saleCheckoutMinimized
          ? "pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))]"
          : "pb-8",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900">{t(lang, "sellTitle")}</h2>
          {quickSell ? <p className="text-sm font-semibold text-waka-800">{t(lang, "quickSellBadge")}</p> : null}
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
      </div>

      {products.length > 0 ? (
        <div className="space-y-2 rounded-2xl border border-stone-200 bg-white p-2 shadow-waka-sm sm:p-2.5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posSellCategoryHeading")}</p>
            <div
              className="mt-1 flex max-w-full gap-1 overflow-x-auto pb-0.5"
              role="tablist"
              aria-label={t(lang, "posSellCategoryHeading")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={sellCategoryKey === CATEGORY_FILTER_ALL}
                onClick={() => setSellCategoryFilter(CATEGORY_FILTER_ALL)}
                className={clsx(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-black transition",
                  sellCategoryKey === CATEGORY_FILTER_ALL
                    ? "border-waka-500 bg-waka-100 text-waka-950"
                    : "border-stone-200 bg-stone-50 text-stone-700 active:bg-stone-100",
                )}
              >
                {t(lang, "posCategoryAll")}
              </button>
              {sellHasUncategorized ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={sellCategoryKey === UNCATEGORIZED_SENTINEL}
                  onClick={() => setSellCategoryFilter(UNCATEGORIZED_SENTINEL)}
                  className={clsx(
                    "shrink-0 rounded-full border px-2.5 py-1 text-xs font-black transition",
                    sellCategoryKey === UNCATEGORIZED_SENTINEL
                      ? "border-waka-500 bg-waka-100 text-waka-950"
                      : "border-stone-200 bg-stone-50 text-stone-700 active:bg-stone-100",
                  )}
                >
                  {t(lang, "uncategorized")}
                </button>
              ) : null}
              {sellCategoryOptions.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={sellCategoryKey === cat}
                  onClick={() => setSellCategoryFilter(cat)}
                  className={clsx(
                    "shrink-0 rounded-full border px-2.5 py-1 text-xs font-black transition",
                    sellCategoryKey === cat
                      ? "border-waka-500 bg-waka-100 text-waka-950"
                      : "border-stone-200 bg-stone-50 text-stone-700 active:bg-stone-100",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={(e) => commitSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSearch(searchQuery);
            }}
            placeholder={t(lang, "posSellSearchPlaceholder")}
            aria-label={t(lang, "posSellSearchPlaceholder")}
            className="h-9 w-full rounded-xl border border-stone-200 bg-stone-50/90 px-2.5 text-sm font-medium text-stone-900 outline-none ring-waka-200 focus:border-waka-400 focus:bg-white focus:ring-1"
          />
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
                    className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900 active:bg-amber-100"
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
          {hasPermission(actor.role, "back_office.access") ? (
            <Link
              to="/office"
              className="mt-6 inline-flex min-h-[56px] items-center justify-center rounded-3xl bg-waka-600 px-8 py-4 text-xl font-black text-white shadow-lg active:bg-waka-700"
            >
              {t(lang, "posEmptyCtaOffice")}
            </Link>
          ) : (
            <p className="mt-4 text-base font-semibold text-stone-600">{t(lang, "posEmptyAskOwner")}</p>
          )}
        </section>
      ) : filteredProducts.length === 0 ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-6 text-center text-lg font-bold text-amber-950">{t(lang, "posSellNoMatch")}</p>
      ) : filteredProducts.length > VIRTUAL_PRODUCT_THRESHOLD ? (
        <VirtualizedProductGrid products={filteredProducts} onPick={openProduct} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filteredProducts.map((p) => (
            <article
              key={p.id}
              className="relative flex min-h-[148px] flex-col justify-between rounded-3xl border-2 border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 pt-12 text-left shadow-sm"
              style={{ contentVisibility: "auto" }}
            >
              <button
                type="button"
                className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-lg shadow-sm active:bg-stone-50"
                aria-label={favoriteIds.includes(p.id) ? t(lang, "posRemoveFavorite") : t(lang, "posToggleFavorite")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavoriteProduct(p.id);
                }}
              >
                {favoriteIds.includes(p.id) ? "★" : "☆"}
              </button>
              <button type="button" onClick={() => openProduct(p)} className="text-left">
                <p className="text-lg font-black leading-tight text-slate-900">{p.name}</p>
                <p className="mt-1 text-xs font-bold text-stone-500">
                  {(p.category ?? "").trim() ? p.category.trim() : t(lang, "uncategorized")} · {p.baseUnit}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {t(lang, "stockLabel")}: {Math.max(0, Math.floor(p.stockOnHand * 1000) / 1000)} {p.baseUnit}
                </p>
                {p.stockOnHand <= p.minimumStockAlert ? (
                  <p className="mt-1 text-xs font-bold text-rose-700">{t(lang, "cardLowStock")}</p>
                ) : null}
                <p className="mt-2 text-base font-black text-waka-700">{formatProductPriceLabel(p)}</p>
              </button>
              <button
                type="button"
                onClick={() => openProduct(p)}
                className="mt-3 min-h-[40px] rounded-2xl bg-waka-600 px-3 py-2 text-sm font-black text-white active:bg-waka-700"
              >
                {t(lang, "addToSale")}
              </button>
            </article>
          ))}
        </div>
      )}

      {draftLines.length > 0 && !saleCheckoutMinimized ? (
        <div
          className="fixed inset-0 z-[44] flex min-h-0 flex-col bg-waka-50 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
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
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ul className="space-y-2 rounded-2xl border border-waka-200 bg-white p-3 shadow-sm">
              {draftLines.map((line) => (
                <li key={line.productId} className="flex items-center justify-between gap-2 text-lg text-slate-900">
                  <span className="min-w-0 font-bold">
                    {line.name}{" "}
                    <span className="text-xs font-medium text-slate-500">
                      {line.inputMode === "money" ? t(lang, "byMoney") : t(lang, "byQuantity")}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-lg font-black">UGX {line.lineTotalUgx.toLocaleString()}</span>
                    <button
                      type="button"
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center text-lg text-red-600 active:bg-red-50"
                      onClick={() => removeDraftLine(line.productId)}
                      aria-label={t(lang, "removeLine")}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-3xl font-black text-slate-900">
              {t(lang, "totalLabel")}{" "}
              <span className="text-waka-700">UGX {draftTotal.toLocaleString()}</span>
            </p>

            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "paymentMethodLabel")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["cash", "mobile_money", "mixed", "credit"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
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

            {paymentMethod === "mixed" || paymentMethod === "credit" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-base font-semibold text-slate-800">
                  {t(lang, "paymentCashLabel")}
                  <input
                    value={cashInput}
                    onChange={(e) => setCashInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-xl font-black"
                    placeholder="0"
                  />
                </label>
                <label className="block text-base font-semibold text-slate-800">
                  {t(lang, "paymentMobileMoneyLabel")}
                  <input
                    value={mobileMoneyInput}
                    onChange={(e) => setMobileMoneyInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-xl font-black"
                    placeholder="0"
                  />
                </label>
              </div>
            ) : null}

            {paymentMethod === "credit" || paymentMethod === "mixed" ? (
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

            <button
              type="button"
              onClick={finishSale}
              className="mt-5 min-h-[56px] w-full rounded-3xl bg-waka-600 py-5 text-2xl font-black text-white shadow-lg active:bg-waka-700"
            >
              {t(lang, "saveSale")}
            </button>
          </div>
        </div>
      ) : null}

      {draftLines.length > 0 && saleCheckoutMinimized ? (
        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom\,0px))] left-0 right-0 z-[45] border-t border-waka-200 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "totalLabel")}</p>
              <p className="truncate text-xl font-black text-waka-700">UGX {draftTotal.toLocaleString()}</p>
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
          className="fixed inset-0 z-[52] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
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
            </div>
            <span className="min-h-[48px] w-[5.5rem] shrink-0" aria-hidden />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-6">
            {(moneyPresets.length > 0 || qtyPresets.length > 0) && (
              <div className="space-y-3">
                <p className="text-center text-sm font-bold uppercase tracking-wide text-slate-500">{t(lang, "tapQuickAmount")}</p>
                {moneyPresets.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {moneyPresets.map((amt) => (
                      <button
                        key={`m-${amt}`}
                        type="button"
                        onClick={() => applyPreset("money", amt)}
                        className="min-h-[56px] min-w-[104px] rounded-2xl bg-waka-600 px-4 text-xl font-black text-white shadow-md active:bg-waka-700"
                      >
                        {amt.toLocaleString()}
                      </button>
                    ))}
                  </div>
                )}
                {qtyPresets.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {qtyPresets.map((q) => (
                      <button
                        key={`q-${q}`}
                        type="button"
                        onClick={() => applyPreset("quantity", q)}
                        className="min-h-[56px] min-w-[92px] rounded-2xl bg-slate-900 px-4 text-xl font-black text-white shadow-md active:bg-slate-800"
                      >
                        {q} {selected.baseUnit}
                      </button>
                    ))}
                  </div>
                )}
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

                <button
                  type="button"
                  onClick={applyDraftInput}
                  className="mt-5 min-h-[56px] w-full rounded-2xl bg-slate-900 py-4 text-lg font-black text-white active:bg-slate-800"
                >
                  {t(lang, "addToSale")}
                </button>
              </>
            )}
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

      {receiptSale && receiptPlain ? (
        <div
          className="fixed inset-0 z-[58] flex items-end justify-center bg-black/50 p-3 pb-[env(safe-area-inset-bottom)] sm:items-center"
          role="dialog"
          aria-modal
        >
          <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-xl font-black text-slate-900">{t(lang, "receiptTitle")}</p>
            </div>
            <pre className="max-h-[42vh] overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-relaxed text-slate-800 sm:max-h-[50vh]">
              {receiptPlain}
            </pre>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4 sm:grid-cols-4">
              <button
                type="button"
                className="min-h-[48px] rounded-2xl bg-slate-900 py-3 text-sm font-black text-white"
                onClick={() => {
                  const w = window.open("", "_blank", "noopener,noreferrer,width=400,height=600");
                  if (!w) return;
                  w.document.open();
                  w.document.write(
                    `<!doctype html><meta charset="utf-8"/><title>Receipt</title><body style="font-family:system-ui,sans-serif;padding:16px"><pre id="waka-r" style="white-space:pre-wrap;margin:0"></pre></body></html>`,
                  );
                  w.document.close();
                  w.document.getElementById("waka-r")!.textContent = receiptPlain;
                  w.focus();
                  w.print();
                  w.close();
                }}
              >
                {t(lang, "receiptPrint")}
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white"
                onClick={() => {
                  window.open(`https://wa.me/?text=${encodeURIComponent(receiptPlain)}`, "_blank", "noopener,noreferrer");
                }}
              >
                {t(lang, "receiptWhatsApp")}
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-2xl border-2 border-slate-200 py-3 text-sm font-black text-slate-800"
                onClick={() => {
                  const a = document.createElement("a");
                  const url = URL.createObjectURL(new Blob([receiptPlain], { type: "text/plain;charset=utf-8" }));
                  a.href = url;
                  a.download = `receipt-${receiptSale.id}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                {t(lang, "receiptDownload")}
              </button>
              <button
                type="button"
                className="min-h-[48px] rounded-2xl border-2 border-slate-200 py-3 text-sm font-bold text-slate-600 sm:col-span-1"
                onClick={() => setReceiptSaleId(null)}
              >
                {t(lang, "receiptClose")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast && (
        <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-2xl bg-slate-900 px-5 py-4 text-center text-base font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}

      {firstSaleOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 pb-[env(safe-area-inset-bottom)]" role="dialog" aria-modal>
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
        </div>
      ) : null}
    </div>
  );
}
