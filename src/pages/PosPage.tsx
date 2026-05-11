import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import type { Language, LineInputMode, Product } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { VirtualizedProductGrid } from "../components/pos/VirtualizedProductGrid";
import { hapticSaleComplete, hapticTap, playSaleSuccessTone } from "../lib/nativeFeedback";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { dateKeyKampala } from "../lib/datesUg";

const VIRTUAL_PRODUCT_THRESHOLD = 16;
const MAX_RECENT_SEARCHES = 6;
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
  const [saleSuccessFlash, setSaleSuccessFlash] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = (p.category ?? "").trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

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

  const frequentToday = useMemo(
    () =>
      products
        .map((p) => ({ product: p, qty: soldTodayByProduct.get(p.id) ?? 0 }))
        .filter((r) => r.qty > 0)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 6),
    [products, soldTodayByProduct],
  );

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const aliasTerms = q ? SEARCH_ALIASES[q] ?? [] : [];
    return products.filter((p) => {
      if (categoryFilter && (p.category ?? "").trim() !== categoryFilter) return false;
      if (!q) return true;
      const searchable = [p.name, p.category, p.baseUnit, p.sku].filter(Boolean).join(" ").toLowerCase();
      if (searchable.includes(q)) return true;
      return aliasTerms.some((term) => searchable.includes(term));
    });
  }, [products, searchQuery, categoryFilter]);

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
    if (hapticsOn) void hapticTap();
    setSheetOpen(false);
    setSelected(null);
    setDisplay("");
  }, [selected, inputMode, display, setDraftInput, addDraftLineFromInput, lang, hapticsOn]);

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
      if (hapticsOn) void hapticTap();
      setSheetOpen(false);
      setSelected(null);
      setDisplay("");
    },
    [selected, setDraftInput, addDraftLineFromInput, lang, hapticsOn],
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
    if (r.firstSale && !preferences.celebratedFirstSale) {
      setFirstSaleOpen(true);
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

  const moneyPresets = selected?.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = selected?.quickPresetsQty?.filter((x) => x > 0) ?? [];

  if (!hasPermission(actor.role, "pos.sell")) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-4 pb-8">
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
        <div className="space-y-3 rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "posSellSearchPlaceholder")}</span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={(e) => commitSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSearch(searchQuery);
              }}
              placeholder={t(lang, "posSellSearchPlaceholder")}
              className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-lg font-semibold text-stone-900 outline-none ring-waka-200 focus:ring"
            />
          </label>
          {recentSearches.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "posRecentSearches")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {recentSearches.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setSearchQuery(item)}
                    className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-700"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {categoryOptions.length > 0 ? (
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "posSellCategoryLabel")}</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-lg font-semibold text-stone-900"
              >
                <option value="">{t(lang, "posSellCategoryAll")}</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {categoryOptions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {categoryOptions.slice(0, 8).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoryFilter((prev) => (prev === c ? "" : c))}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs font-bold",
                    categoryFilter === c ? "border-waka-400 bg-waka-50 text-waka-900" : "border-stone-200 bg-white text-stone-700",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}
          {frequentToday.length > 0 ? (
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "posFrequentToday")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {frequentToday.map(({ product, qty }) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => openProduct(product)}
                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900"
                  >
                    {product.name} · {qty}
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
              className="flex min-h-[148px] flex-col justify-between rounded-3xl border-2 border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 text-left shadow-sm"
              style={{ contentVisibility: "auto" }}
            >
              <button type="button" onClick={() => openProduct(p)} className="text-left">
                <p className="text-lg font-black leading-tight text-slate-900">{p.name}</p>
                <p className="mt-1 text-xs font-bold text-stone-500">
                  {p.category || t(lang, "generalCategory")} · {p.baseUnit}
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

      {draftLines.length > 0 && (
        <section className="rounded-3xl border-2 border-waka-200 bg-waka-50 p-5 shadow-sm">
          <p className="text-base font-bold text-waka-950">{t(lang, "thisSale")}</p>
          <ul className="mt-3 space-y-2">
            {draftLines.map((line) => (
              <li key={line.productId} className="flex items-center justify-between gap-2 text-lg text-slate-900">
                <span className="font-bold">
                  {line.name}{" "}
                  <span className="text-xs font-medium text-slate-500">
                    {line.inputMode === "money" ? t(lang, "byMoney") : t(lang, "byQuantity")}
                  </span>
                </span>
                <div className="flex items-center gap-2">
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

          {(paymentMethod === "mixed" || paymentMethod === "credit") ? (
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
        </section>
      )}

      {sheetOpen && selected && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50 pb-[env(safe-area-inset-bottom)]" role="dialog" aria-modal>
          <div className="max-h-[94vh] overflow-y-auto rounded-t-[2rem] bg-white p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-200" />
            <p className="text-center text-2xl font-black text-slate-900">{selected.name}</p>
            <p className="mt-1 text-center text-base text-slate-500">{formatProductPriceLabel(selected)}</p>

            {(moneyPresets.length > 0 || qtyPresets.length > 0) && (
              <div className="mt-5 space-y-3">
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

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="min-h-[52px] rounded-2xl border-2 border-slate-200 py-4 text-lg font-bold active:bg-slate-50"
                  >
                    {t(lang, "cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={applyDraftInput}
                    className="min-h-[52px] rounded-2xl bg-slate-900 py-4 text-lg font-black text-white active:bg-slate-800"
                  >
                    {t(lang, "addToSale")}
                  </button>
                </div>
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
                  setPreferences({ celebratedFirstSale: true });
                  setFirstSaleOpen(false);
                }}
              >
                {t(lang, "firstSaleSeeHome")}
              </Link>
              <button
                type="button"
                className="min-h-[52px] w-full rounded-2xl border-2 border-slate-300 py-4 text-lg font-bold text-slate-800 active:bg-slate-50"
                onClick={() => {
                  setPreferences({ celebratedFirstSale: true });
                  setFirstSaleOpen(false);
                  setToast(t(lang, "saleSaved"));
                  window.setTimeout(() => setToast(null), 1600);
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
