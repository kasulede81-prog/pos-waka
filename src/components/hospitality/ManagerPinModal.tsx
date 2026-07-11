import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterprisePinPad } from "../auth/EnterprisePinPad";
import { verifyManagerApprovalPinSync } from "../../lib/enterpriseSecurity/EnterpriseSecurityService";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  lang: Language;
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (input: { reason: string; managerPin: string }) => void;
  busy?: boolean;
};

export function ManagerPinModal({ lang, open, title, onClose, onConfirm, busy = false }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const [reason, setReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [pinReady, setPinReady] = useState(false);
  const [pinResetSignal, setPinResetSignal] = useState(0);

  if (!open) return null;

  const reset = () => {
    setReason("");
    setManagerPin("");
    setPinReady(false);
    setPinResetSignal((n) => n + 1);
  };

  return (
    <ModalSheet
      open
      onClose={() => {
        reset();
        onClose();
      }}
      zIndexClass="z-[80]"
      clearNav
      title={<h2 className="text-lg font-black text-foreground">{title}</h2>}
      footer={
        <button
          type="button"
          disabled={busy || !reason.trim() || !pinReady}
          onClick={() => {
            onConfirm({ reason: reason.trim(), managerPin });
            reset();
          }}
          className="min-h-14 w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {busy ? "…" : t(lang, "tableSettleConfirm")}
        </button>
      }
    >
      <label className="mb-3 block">
        <span className="text-sm font-bold text-muted-foreground">{t(lang, "reasonRequiredLabel")}</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 min-h-[72px] w-full rounded-xl border border-border px-3 py-2 text-sm font-medium"
        />
      </label>
      <p className="text-sm font-bold text-muted-foreground">{t(lang, "managerPinLabel")}</p>
      <EnterprisePinPad
        lang={lang}
        disabled={busy}
        resetSignal={pinResetSignal}
        className="mt-2"
        onComplete={(pin) => {
          if (!verifyManagerApprovalPinSync(pin, preferences)) {
            setPinReady(false);
            setManagerPin("");
            return false;
          }
          setManagerPin(pin);
          setPinReady(true);
          return true;
        }}
      />
    </ModalSheet>
  );
}
