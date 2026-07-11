import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { EnterprisePinPad } from "../auth/EnterprisePinPad";
import { hashShopSecurityPin } from "../../lib/enterpriseSecurity/shopPinSecret";
import { isShopSecurityPinConfigured } from "../../lib/enterpriseSecurity/shopPinSecret";

type Props = { lang: Language };

export function BackOfficePinForm({ lang }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [boPinNew, setBoPinNew] = useState("");
  const [step, setStep] = useState<"new" | "confirm">("new");
  const [boPinFeedback, setBoPinFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const pinActive = isShopSecurityPinConfigured(preferences.backOfficePin);

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      {pinActive ? (
        <p className="text-sm font-semibold text-emerald-800">{t(lang, "settingsBackOfficePinActiveShort")}</p>
      ) : (
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "settingsBackOfficePinNone")}</p>
      )}
      {boPinFeedback ? <p className="mt-2 text-sm font-bold text-waka-900">{boPinFeedback}</p> : null}
      <p className="mt-4 text-sm font-bold text-foreground">
        {step === "new" ? t(lang, "settingsBackOfficePinNew") : t(lang, "settingsBackOfficePinConfirm")}
      </p>
      <EnterprisePinPad
        lang={lang}
        disabled={saving}
        resetSignal={`${step}-${resetSignal}`}
        className="mt-3"
        onComplete={(pin: string) => {
          if (step === "new") {
            setBoPinNew(pin);
            setStep("confirm");
            setBoPinFeedback(null);
            return true;
          }
          if (boPinNew !== pin) {
            setBoPinFeedback(t(lang, "settingsBackOfficePinMismatch"));
            setBoPinNew("");
            setStep("new");
            setResetSignal((n) => n + 1);
            return false;
          }
          setSaving(true);
          void hashShopSecurityPin(pin).then((hash) => {
            setSaving(false);
            if (!hash) {
              setBoPinFeedback(t(lang, "settingsBackOfficePinLength"));
              setResetSignal((n) => n + 1);
              return;
            }
            setPreferences({ backOfficePin: hash });
            setBoPinNew("");
            setStep("new");
            setResetSignal((n) => n + 1);
            setBoPinFeedback(t(lang, "settingsBackOfficePinSaved"));
          });
          return true;
        }}
      />
      <div className="mt-4">
        <button
          type="button"
          className="min-h-[48px] w-full rounded-2xl border-2 border-border py-3 text-sm font-bold text-foreground"
          onClick={() => {
            setBoPinNew("");
            setStep("new");
            setResetSignal((n) => n + 1);
            setPreferences({ backOfficePin: null });
            setBoPinFeedback(t(lang, "settingsBackOfficePinCleared"));
          }}
        >
          {t(lang, "settingsBackOfficePinClear")}
        </button>
      </div>
    </article>
  );
}
