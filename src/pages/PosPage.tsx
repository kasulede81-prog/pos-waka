import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import clsx from "clsx";
import type { Language, LineInputMode, Product } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { VirtualizedProductGrid } from "../components/pos/VirtualizedProductGrid";
import { hapticSaleComplete, hapticTap, playSaleSuccessTone } from "../lib/nativeFeedback";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

const VIRTUAL_PRODUCT_THRESHOLD = 16;

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
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const preferences = usePosStore((s) => s.preferences);
  const draftLines = usePosStore((s) => s.draftLines);
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const removeDraftLine = usePosStore((s) => s.removeDraftLine);
  const clearDraft = usePosStore((s) => s.clearDraft);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);
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
  const [debtInput, setDebtInput] = useState("0");
  const [saleCustomerId, setSaleCustomerId] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [firstSaleOpen, setFirstSaleOpen] = useState(false);
  const [saleSuccessFlash, setSaleSuccessFlash] = useState(false);

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

  const finishSale = useCallback(() => {
    const debt = parseDisplayMoney(debtInput);
    const r = finalizeDraftSale({
      debtUgx: debt,
      customerId: saleCustomerId || null,
    });
    if (!r.ok) {
      setToast(t(lang, r.errorKey ?? "saleError"));
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    if (hapticsOn) void hapticSaleComplete();
    if (soundOn) playSaleSuccessTone();

    setDebtInput("0");
    setSaleCustomerId("");
    if (r.firstSale && !preferences.celebratedFirstSale) {
      setFirstSaleOpen(true);
    } else {
      setSaleSuccessFlash(true);
      window.setTimeout(() => setSaleSuccessFlash(false), 720);
      setToast(t(lang, "saleSaved"));
      window.setTimeout(() => setToast(null), 1600);
    }
  }, [
    debtInput,
    saleCustomerId,
    finalizeDraftSale,
    lang,
    hapticsOn,
    soundOn,
    preferences.celebratedFirstSale,
  ]);

  const moneyPresets = selected?.quickPresetsMoneyUgx?.filter((x) => x > 0) ?? [];
  const qtyPresets = selected?.quickPresetsQty?.filter((x) => x > 0) ?? [];

  if (!hasPermission(actor.role, "pos.sell")) {
    return <Navigate to="/stock" replace />;
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

      {products.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-2xl font-black text-slate-900">{t(lang, "posEmptyTitle")}</p>
          <p className="mt-2 text-lg text-slate-600">{t(lang, "posEmptySub")}</p>
          <Link
            to="/stock"
            className="mt-6 inline-flex min-h-[56px] items-center justify-center rounded-3xl bg-waka-600 px-8 py-4 text-xl font-black text-white shadow-lg active:bg-waka-700"
          >
            {t(lang, "posEmptyCta")}
          </Link>
        </section>
      ) : products.length > VIRTUAL_PRODUCT_THRESHOLD ? (
        <VirtualizedProductGrid products={products} onPick={openProduct} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openProduct(p)}
              className="flex min-h-[120px] flex-col justify-between rounded-3xl border-2 border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 text-left shadow-sm active:scale-[0.98] active:border-waka-500 motion-reduce:active:scale-100"
              style={{ contentVisibility: "auto" }}
            >
              <span className="text-xl font-black leading-tight text-slate-900">{p.name}</span>
              <span className="mt-2 text-base font-bold text-waka-700">{formatProductPriceLabel(p)}</span>
            </button>
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

          {customers.length > 0 && (
            <label className="mt-4 block text-base font-semibold text-slate-800">
              {t(lang, "whoOwes")}
              <select
                value={saleCustomerId}
                onChange={(e) => setSaleCustomerId(e.target.value)}
                className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-lg font-medium"
              >
                <option value="">{t(lang, "noPersonCashOnly")}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.debtBalanceUgx > 0 ? ` — ${t(lang, "debtBalanceShort")} UGX ${c.debtBalanceUgx.toLocaleString()}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-4 block text-base font-semibold text-amber-950">
            {t(lang, "onCreditAmount")}
            <input
              value={debtInput}
              onChange={(e) => setDebtInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-amber-200 bg-white px-4 py-4 text-2xl font-black"
              placeholder="0"
            />
          </label>

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
