import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { PosScreenPortal } from "../layout/PosScreenPortal";
import { MoneyInput } from "../ui/MoneyInput";

type Mode = "fixed" | "percent";

type Props = {
  lang: Language;
  open: boolean;
  lineSubtotalUgx: number;
  currentDiscountUgx: number;
  onClose: () => void;
  onApply: (discountUgx: number) => void;
};

export function CartSaleDiscountModal({ lang, open, lineSubtotalUgx, currentDiscountUgx, onClose, onApply }: Props) {
  const [mode, setMode] = useState<Mode>("fixed");
  const [fixedInput, setFixedInput] = useState("");
  const [percentInput, setPercentInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode("fixed");
    setFixedInput(currentDiscountUgx > 0 ? String(currentDiscountUgx) : "");
    setPercentInput(
      lineSubtotalUgx > 0 && currentDiscountUgx > 0
        ? String(Math.round((currentDiscountUgx / lineSubtotalUgx) * 100))
        : "",
    );
  }, [open, currentDiscountUgx, lineSubtotalUgx]);

  if (!open) return null;

  const fixed = Math.min(Math.max(0, Math.floor(Number(fixedInput.replace(/\D/g, "")) || 0)), lineSubtotalUgx);
  const pct = Math.min(100, Math.max(0, Math.floor(Number(percentInput.replace(/\D/g, "")) || 0)));
  const discountUgx = mode === "percent" ? Math.min(lineSubtotalUgx, Math.round((lineSubtotalUgx * pct) / 100)) : fixed;
  const payable = Math.max(0, lineSubtotalUgx - discountUgx);

  return (
    <PosScreenPortal>
      <ModalSheet
        open
        onClose={onClose}
        zIndexClass="z-[var(--waka-z-pos-modal)]"
        clearNav={false}
        title={t(lang, "cartDiscountTitle")}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(0);
                onClose();
              }}
              className="min-h-[52px] rounded-2xl border-2 border-stone-200 text-base font-bold text-stone-700"
            >
              {t(lang, "cartDiscountClear")}
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(discountUgx);
                onClose();
              }}
              className="min-h-[52px] rounded-2xl bg-waka-600 text-base font-black text-white"
            >
              {t(lang, "discountApply")}
            </button>
          </div>
        }
      >
        <p className="text-sm font-semibold text-stone-600">
          {t(lang, "cartDiscountOriginal")}:{" "}
          <span className="font-black text-stone-900">UGX {lineSubtotalUgx.toLocaleString()}</span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("fixed")}
            className={`min-h-[44px] rounded-2xl border-2 text-sm font-black ${
              mode === "fixed" ? "border-waka-500 bg-waka-100 text-waka-950" : "border-stone-200 text-stone-700"
            }`}
          >
            {t(lang, "cartDiscountFixed")}
          </button>
          <button
            type="button"
            onClick={() => setMode("percent")}
            className={`min-h-[44px] rounded-2xl border-2 text-sm font-black ${
              mode === "percent" ? "border-waka-500 bg-waka-100 text-waka-950" : "border-stone-200 text-stone-700"
            }`}
          >
            {t(lang, "cartDiscountPercent")}
          </button>
        </div>

        {mode === "fixed" ? (
          <label className="mt-4 block">
            <span className="text-sm font-bold text-stone-700">{t(lang, "cartDiscountAmountLabel")}</span>
            <MoneyInput
              value={fixedInput}
              onChange={(e) => setFixedInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
              autoFocus
              className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-stone-200 px-4 text-center text-2xl font-black"
            />
          </label>
        ) : (
          <label className="mt-4 block">
            <span className="text-sm font-bold text-stone-700">{t(lang, "cartDiscountPercentLabel")}</span>
            <input
              type="text"
              inputMode="numeric"
              value={percentInput}
              onChange={(e) => setPercentInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-stone-200 px-4 text-center text-2xl font-black"
            />
          </label>
        )}

        {discountUgx > 0 ? (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-center text-sm font-black text-emerald-900">
            {tTemplate(lang, "cartDiscountSummary", {
              discount: discountUgx.toLocaleString(),
              payable: payable.toLocaleString(),
            })}
          </p>
        ) : null}
      </ModalSheet>
    </PosScreenPortal>
  );
}
