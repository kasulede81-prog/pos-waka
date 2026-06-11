import { memo, useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { PosScreenPortal } from "../layout/PosScreenPortal";

const QtyNumpad = memo(function QtyNumpad({
  onDigit,
  onClear,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onDigit(k)}
            className="min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200"
          >
            {k}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([".", "0", "⌫"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (k === "⌫") onDigit("back");
              else onDigit(k);
            }}
            className="min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200"
          >
            {k}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="w-full min-h-[52px] rounded-2xl bg-amber-100 py-3 text-lg font-bold text-amber-900 active:bg-amber-200"
      >
        C
      </button>
    </div>
  );
});

function parseQtyDisplay(s: string): number {
  const cleaned = s.replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  lang: Language;
  open: boolean;
  productName: string;
  qtyLabel: string;
  initialQuantity: number;
  onClose: () => void;
  onConfirm: (quantity: number) => void;
};

export function QuantityEditModal({
  lang,
  open,
  productName,
  qtyLabel,
  initialQuantity,
  onClose,
  onConfirm,
}: Props) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!open) return;
    const shown = Number.isInteger(initialQuantity)
      ? String(initialQuantity)
      : String(initialQuantity);
    setDisplay(shown);
  }, [open, initialQuantity]);

  const appendDigit = useCallback((d: string) => {
    if (d === "back") {
      setDisplay((x) => x.slice(0, -1));
      return;
    }
    if (d === ".") {
      setDisplay((x) => (x.includes(".") ? x : x.length ? `${x}.` : "0."));
      return;
    }
    setDisplay((x) => {
      const next = x + d;
      if (next.includes(".") && (next.split(".")[1]?.length ?? 0) > 4) return x;
      return next.length > 12 ? x : next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const qty = parseQtyDisplay(display);
    if (qty <= 0) return;
    onConfirm(qty);
    onClose();
  }, [display, onConfirm, onClose]);

  if (!open) return null;

  return (
    <PosScreenPortal>
    <AppModalOverlay
      clearNav={false}
      className="z-[var(--waka-z-pos-modal)] flex items-end justify-center bg-black/55 pb-[env(safe-area-inset-bottom,0px)] sm:items-center"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md rounded-t-[1.75rem] border border-slate-200 bg-white p-4 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        aria-labelledby="qty-edit-title"
      >
        <p id="qty-edit-title" className="truncate text-center text-lg font-black text-slate-900">
          {productName}
        </p>
        <p className="mt-1 text-center text-sm font-semibold text-slate-500">{qtyLabel}</p>
        <p className="mt-4 text-center text-xs font-black uppercase tracking-wide text-slate-500">
          {t(lang, "posQtyEditLabel")}
        </p>
        <div className="mt-2 flex min-h-[64px] items-center justify-center rounded-2xl border-2 border-waka-300 bg-waka-50 px-4">
          <span className="text-4xl font-black tabular-nums text-waka-950">{display || "0"}</span>
        </div>
        <div className="mt-4">
          <QtyNumpad onDigit={appendDigit} onClear={() => setDisplay("")} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[52px] rounded-2xl border-2 border-slate-200 bg-white text-base font-black text-slate-700 active:bg-slate-50"
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="min-h-[52px] rounded-2xl bg-waka-600 text-base font-black text-white active:bg-waka-700"
          >
            {t(lang, "posQtyUpdate")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
    </PosScreenPortal>
  );
}
