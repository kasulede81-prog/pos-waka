import { useState } from "react";
import clsx from "clsx";
import type { Language, SaleLine } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { listPriceForLine, type DiscountMode } from "../../lib/saleAdjustments";

type Props = {
  lang: Language;
  open: boolean;
  line: SaleLine | null;
  onClose: () => void;
  onApply: (mode: DiscountMode, value: number) => void;
};

export function DiscountLineModal({ lang, open, line, onClose, onApply }: Props) {
  const [mode, setMode] = useState<DiscountMode>("final");
  const [custom, setCustom] = useState("");

  if (!open || !line) return null;

  const list = listPriceForLine(line);
  const customN = Math.floor(Number(custom.replace(/\D/g, "")) || 0);

  const preview = (() => {
    if (mode === "percent") return Math.round(list * 0.9);
    if (mode === "amount") return Math.max(0, list - Math.round(list * 0.1));
    return customN > 0 ? customN : list;
  })();

  return (
    <AppModalOverlay className="z-[64] flex items-end justify-center bg-black/55 sm:items-center" role="dialog" aria-modal onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-[1.75rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-slate-900">{t(lang, "discountTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-600">{line.name}</p>
        <p className="mt-2 text-sm text-slate-500">
          {t(lang, "discountOriginal")}: <span className="font-black text-slate-800">UGX {list.toLocaleString()}</span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(
            [
              { id: "percent" as const, label: "10%", value: 10 },
              { id: "percent" as const, label: "20%", value: 20 },
            ] as const
          ).map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onApply("percent", opt.value)}
              className="min-h-[56px] rounded-2xl bg-waka-600 text-lg font-black text-white active:bg-waka-700"
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("amount")}
            className={clsx(
              "min-h-[48px] rounded-2xl border-2 text-sm font-black",
              mode === "amount" ? "border-waka-500 bg-waka-50 text-waka-950" : "border-slate-200 text-slate-800",
            )}
          >
            {t(lang, "discountCustomAmount")}
          </button>
          <button
            type="button"
            onClick={() => setMode("final")}
            className={clsx(
              "min-h-[48px] rounded-2xl border-2 text-sm font-black",
              mode === "final" ? "border-waka-500 bg-waka-50 text-waka-950" : "border-slate-200 text-slate-800",
            )}
          >
            {t(lang, "discountCustomFinal")}
          </button>
        </div>

        {mode !== "percent" ? (
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 9))}
            inputMode="numeric"
            placeholder={mode === "final" ? String(list) : "500"}
            className="mt-3 min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-2xl font-black outline-none ring-waka-300 focus:ring"
          />
        ) : null}

        {customN > 0 || mode === "percent" ? (
          <p className="mt-2 text-sm font-bold text-emerald-800">
            {tTemplate(lang, "discountPreview", {
              final: preview.toLocaleString(),
              off: Math.max(0, list - preview).toLocaleString(),
            })}
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 py-3 font-bold text-slate-700">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={mode !== "percent" && customN <= 0}
            onClick={() => {
              if (mode === "percent") return;
              onApply(mode, customN);
            }}
            className="min-h-[52px] rounded-2xl bg-slate-900 py-3 font-black text-white disabled:opacity-50"
          >
            {t(lang, "discountApply")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
