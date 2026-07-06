import { useState } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { usePosStore } from "../../../store/usePosStore";
import { verifyOwnerPin } from "../../../lib/sensitiveActionAuth";

type Props = {
  lang: Language;
  open: boolean;
  prescriptionNumber: string;
  onClose: () => void;
  onApproved: (reason: string, pin: string) => void;
};

export function PharmacyControlledApprovalModal({
  lang,
  open,
  prescriptionNumber,
  onClose,
  onApproved,
}: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = () => {
    if (!reason.trim()) {
      setError(t(lang, "pharmacyRxControlledReasonRequired"));
      return;
    }
    if (!verifyOwnerPin(pin, preferences)) {
      setError(t(lang, "pinIncorrect"));
      return;
    }
    onApproved(reason.trim(), pin);
    setPin("");
    setReason("");
    setError(null);
    onClose();
  };

  return (
    <AppModalOverlay className="z-[79] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <h2 className="text-xl font-black text-violet-950">{t(lang, "pharmacyRxControlledTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-stone-600">{prescriptionNumber}</p>
        <label className="mt-4 block text-sm font-bold text-stone-800">
          {t(lang, "pharmacyRxControlledReason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base"
          />
        </label>
        <label className="mt-3 block text-sm font-bold text-stone-800">
          {t(lang, "pharmacyRxManagerPin")}
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base font-mono"
          />
        </label>
        {error ? <p className="mt-2 text-sm font-bold text-rose-700">{error}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button type="button" onClick={submit} className="min-h-[48px] rounded-xl bg-violet-700 font-black text-white">
            {t(lang, "pharmacyRxApprove")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
