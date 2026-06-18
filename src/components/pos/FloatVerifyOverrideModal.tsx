import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";

export type FloatOverrideAction = "accept_cashier" | "correct_day_open" | "reject";

type Props = {
  lang: Language;
  open: boolean;
  expectedUgx: number;
  verifiedUgx: number;
  canCorrectDayOpen: boolean;
  onClose: () => void;
  onConfirm: (input: { pin: string; action: FloatOverrideAction; reason: string }) => void;
};

export function FloatVerifyOverrideModal({
  lang,
  open,
  expectedUgx,
  verifiedUgx,
  canCorrectDayOpen,
  onClose,
  onConfirm,
}: Props) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<FloatOverrideAction>("accept_cashier");

  if (!open) return null;

  const variance = verifiedUgx - expectedUgx;

  return (
    <AppModalOverlay className="z-[90] flex items-center justify-center bg-stone-950/85 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-black text-stone-900">{t(lang, "shiftFloatOverrideTitle")}</h2>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "shiftFloatOverrideBody")}</p>
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          Expected UGX {expectedUgx.toLocaleString()} · Counted UGX {verifiedUgx.toLocaleString()} (
          {variance >= 0 ? "+" : ""}
          {variance.toLocaleString()})
        </p>

        <label className="mt-4 block text-sm font-bold text-stone-800">
          {t(lang, "shiftFloatOverridePin")}
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-xl font-black tracking-widest"
          />
        </label>

        <label className="mt-3 block text-sm font-bold text-stone-800">
          {t(lang, "shiftFloatOverrideReason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-stone-200 px-4 text-sm font-semibold"
          />
        </label>

        <div className="mt-4 space-y-2">
          {(
            [
              ["accept_cashier", "shiftFloatOverrideAccept"],
              ...(canCorrectDayOpen ? [["correct_day_open", "shiftFloatOverrideCorrectDay"] as const] : []),
              ["reject", "shiftFloatOverrideReject"],
            ] as const
          ).map(([value, labelKey]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 px-3 py-2">
              <input
                type="radio"
                name="override-action"
                checked={action === value}
                onChange={() => setAction(value)}
              />
              <span className="text-sm font-bold text-stone-800">{t(lang, labelKey)}</span>
            </label>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm({ pin, action, reason });
              setPin("");
              setReason("");
            }}
            className="min-h-[48px] rounded-2xl bg-waka-600 font-black text-white"
          >
            {t(lang, "save")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
