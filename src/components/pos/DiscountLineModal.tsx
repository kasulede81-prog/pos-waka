import { useEffect, useMemo, useState } from "react";
import type { Language, SaleLine } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { MoneyInput } from "../ui/MoneyInput";
import { listPriceForLine } from "../../lib/saleAdjustments";

const QUICK_RATES = [0.9, 0.8, 0.7] as const;
const QUICK_PCT_KEYS = ["discountQuick90", "discountQuick80", "discountQuick70"] as const;

type Props = {
  lang: Language;
  open: boolean;
  line: SaleLine | null;
  onClose: () => void;
  onApply: (newSellingPriceUgx: number) => void;
};

export function DiscountLineModal({ lang, open, line, onClose, onApply }: Props) {
  const [newPriceInput, setNewPriceInput] = useState("");

  const list = line ? listPriceForLine(line) : 0;

  useEffect(() => {
    if (!open || !line) return;
    setNewPriceInput(String(line.lineTotalUgx > 0 ? line.lineTotalUgx : list));
  }, [open, line, list]);

  const quickPrices = useMemo(
    () => QUICK_RATES.map((rate) => Math.max(0, Math.round(list * rate))),
    [list],
  );

  if (!open || !line) return null;

  const newPrice = Math.floor(Number(newPriceInput.replace(/\D/g, "")) || 0);
  const discountGiven = Math.max(0, list - newPrice);
  const canApply = newPrice > 0;

  const applyPrice = (priceUgx: number) => {
    onApply(priceUgx);
  };

  return (
    <AppModalOverlay
      className="z-[64] flex items-end justify-center bg-black/55 sm:items-center"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-[1.75rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-slate-900">{t(lang, "discountTitle")}</h2>

        <p className="mt-4 text-2xl font-black text-slate-900">{line.name}</p>
        <p className="mt-1 text-base font-semibold text-slate-600">
          {t(lang, "discountOriginal")}:{" "}
          <span className="font-black text-slate-900">UGX {list.toLocaleString()}</span>
        </p>

        <label className="mt-5 block">
          <span className="text-sm font-bold text-slate-700">{t(lang, "discountNewPrice")}</span>
          <MoneyInput
            value={newPriceInput}
            onChange={(e) => setNewPriceInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
            autoFocus
            className="mt-2 min-h-[60px] w-full rounded-2xl border-2 border-slate-200 px-4 text-center text-3xl font-black text-slate-900 outline-none ring-waka-300 focus:border-waka-400 focus:ring-2"
          />
        </label>

        {discountGiven > 0 ? (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-center text-base font-black text-emerald-900">
            {tTemplate(lang, "discountGiven", { amount: discountGiven.toLocaleString() })}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-3 gap-2">
          {QUICK_PCT_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => setNewPriceInput(String(quickPrices[i]!))}
              className="min-h-[52px] rounded-2xl border-2 border-waka-200 bg-waka-50 py-2 text-sm font-black leading-tight text-waka-950 active:bg-waka-100"
            >
              {t(lang, key)}
            </button>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {quickPrices.map((price) => (
            <button
              key={price}
              type="button"
              onClick={() => setNewPriceInput(String(price))}
              className="min-h-[52px] rounded-2xl bg-waka-600 py-2 text-sm font-black text-white active:bg-waka-700"
            >
              {tTemplate(lang, "discountQuickUgx", { amount: price.toLocaleString() })}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[52px] rounded-2xl border-2 border-slate-200 py-3 text-base font-bold text-slate-700"
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={() => applyPrice(newPrice)}
            className="min-h-[52px] rounded-2xl bg-waka-600 py-3 text-base font-black text-white disabled:opacity-40"
          >
            {t(lang, "discountApply")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
