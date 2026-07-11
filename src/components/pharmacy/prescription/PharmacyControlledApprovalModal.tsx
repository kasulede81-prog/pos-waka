import { useState } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { EnterpriseApprovalPinPad } from "../../auth/EnterpriseApprovalPinPad";
import { usePosStore } from "../../../store/usePosStore";

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
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pinResetSignal, setPinResetSignal] = useState(0);

  if (!open) return null;

  const close = () => {
    setReason("");
    setError(null);
    setPinResetSignal((n) => n + 1);
    onClose();
  };

  return (
    <AppModalOverlay className="z-[79] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl">
        <h2 className="text-xl font-black text-violet-950">{t(lang, "pharmacyRxControlledTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">{prescriptionNumber}</p>
        <label className="mt-4 block text-sm font-bold text-foreground">
          {t(lang, "pharmacyRxControlledReason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base"
          />
        </label>
        <p className="mt-3 text-sm font-bold text-foreground">{t(lang, "pharmacyRxManagerPin")}</p>
        <EnterpriseApprovalPinPad
          lang={lang}
          preferences={preferences}
          disabled={!reason.trim()}
          resetSignal={pinResetSignal}
          className="mt-2"
          onApproved={(pin) => {
            if (!reason.trim()) {
              setError(t(lang, "pharmacyRxControlledReasonRequired"));
              setPinResetSignal((n) => n + 1);
              return false;
            }
            onApproved(reason.trim(), pin);
            close();
            return true;
          }}
        />
        {error ? <p className="mt-2 text-sm font-bold text-danger">{error}</p> : null}
        <button type="button" onClick={close} className="mt-4 min-h-[48px] w-full rounded-xl border-2 font-bold">
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
