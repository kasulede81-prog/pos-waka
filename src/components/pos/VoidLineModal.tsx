import { useState } from "react";
import clsx from "clsx";
import type { Language, SaleLine, VoidReason } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";

const REASONS: VoidReason[] = ["wrong_item", "customer_changed_mind", "returned_item", "wrong_quantity", "other"];

type Props = {
  lang: Language;
  open: boolean;
  line: SaleLine | null;
  onClose: () => void;
  onConfirm: (reason: VoidReason, note: string) => void;
};

export function VoidLineModal({ lang, open, line, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState<VoidReason>("customer_changed_mind");
  const [note, setNote] = useState("");

  if (!open || !line) return null;

  return (
    <AppModalOverlay className="z-[64] flex items-end justify-center bg-black/55 sm:items-center" role="dialog" aria-modal onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-[1.75rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-slate-900">{t(lang, "voidTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-600">{line.name}</p>
        <p className="mt-1 text-lg font-black text-rose-700">UGX {line.lineTotalUgx.toLocaleString()}</p>
        <p className="mt-2 text-sm text-slate-500">{t(lang, "voidHint")}</p>

        <p className="mt-4 text-sm font-bold text-slate-800">{t(lang, "voidReasonLabel")}</p>
        <div className="mt-2 space-y-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={clsx(
                "flex min-h-[48px] w-full items-center rounded-2xl border-2 px-4 text-left text-base font-black",
                reason === r ? "border-rose-500 bg-rose-50 text-rose-950" : "border-slate-200 text-slate-900",
              )}
            >
              {t(lang, `voidReason_${r}`)}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-bold text-slate-800">
          {t(lang, "voidNoteOptional")}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-slate-200 px-3 text-base"
            placeholder={t(lang, "voidNotePh")}
          />
        </label>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 py-3 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason, note.trim())}
            className="min-h-[52px] rounded-2xl bg-rose-600 py-3 font-black text-white"
          >
            {t(lang, "voidConfirm")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
