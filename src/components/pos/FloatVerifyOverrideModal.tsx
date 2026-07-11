import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterpriseApprovalPinPad } from "../auth/EnterpriseApprovalPinPad";
import { usePosStore } from "../../store/usePosStore";

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
  const preferences = usePosStore((s) => s.preferences);
  const [pin, setPin] = useState("");
  const [pinReady, setPinReady] = useState(false);
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<FloatOverrideAction>("accept_cashier");
  const [pinResetSignal, setPinResetSignal] = useState(0);

  if (!open) return null;

  const variance = verifiedUgx - expectedUgx;

  const reset = () => {
    setPin("");
    setPinReady(false);
    setReason("");
    setPinResetSignal((n) => n + 1);
  };

  return (
    <ModalSheet
      open
      onClose={() => {
        reset();
        onClose();
      }}
      zIndexClass="z-[90]"
      clearNav={false}
      title={t(lang, "shiftFloatOverrideTitle")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={!pinReady}
            onClick={() => {
              onConfirm({ pin, action, reason });
              reset();
            }}
            className="min-h-[48px] rounded-2xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "save")}
          </button>
        </div>
      }
    >
      <p className="text-sm font-medium text-muted-foreground">{t(lang, "shiftFloatOverrideBody")}</p>
      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
        Expected UGX {expectedUgx.toLocaleString()} · Counted UGX {verifiedUgx.toLocaleString()} (
        {variance >= 0 ? "+" : ""}
        {variance.toLocaleString()})
      </p>

      <p className="mt-4 text-sm font-bold text-foreground">{t(lang, "shiftFloatOverridePin")}</p>
      <EnterpriseApprovalPinPad
        lang={lang}
        preferences={preferences}
        resetSignal={pinResetSignal}
        className="mt-2"
        onApproved={(approvedPin) => {
          setPin(approvedPin);
          setPinReady(true);
        }}
      />

      <label className="mt-3 block text-sm font-bold text-foreground">
        {t(lang, "shiftFloatOverrideReason")}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-border px-4 text-sm font-semibold"
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
          <label key={value} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2">
            <input
              type="radio"
              name="override-action"
              checked={action === value}
              onChange={() => setAction(value)}
            />
            <span className="text-sm font-bold text-foreground">{t(lang, labelKey)}</span>
          </label>
        ))}
      </div>
    </ModalSheet>
  );
}
