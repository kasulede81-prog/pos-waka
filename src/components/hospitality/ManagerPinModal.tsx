import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";

type Props = {
  lang: Language;
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (input: { reason: string; managerPin: string }) => void;
  busy?: boolean;
};

export function ManagerPinModal({ lang, open, title, onClose, onConfirm, busy = false }: Props) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[80]"
      clearNav={false}
      title={<h2 className="text-lg font-black text-stone-950">{title}</h2>}
      footer={
        <button
          type="button"
          disabled={busy || !reason.trim() || pin.trim().length < 4}
          onClick={() => onConfirm({ reason: reason.trim(), managerPin: pin.trim() })}
          className="min-h-14 w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {busy ? "…" : t(lang, "tableSettleConfirm")}
        </button>
      }
    >
      <label className="mb-3 block">
        <span className="text-sm font-bold text-stone-700">{t(lang, "reasonRequiredLabel")}</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 min-h-[72px] w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold text-stone-700">{t(lang, "managerPinLabel")}</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          type="password"
          className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 px-4 text-xl font-black tracking-widest"
        />
      </label>
    </ModalSheet>
  );
}
