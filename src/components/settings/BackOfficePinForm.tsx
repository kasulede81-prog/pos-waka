import { useEffect, useState } from "react";

import type { Language } from "../../types";

import { t } from "../../lib/i18n";

import { usePosStore } from "../../store/usePosStore";

import { EnterprisePinPad } from "../auth/EnterprisePinPad";

import { hashShopSecurityPin, isShopSecurityPinConfigured, verifyShopSecurityPinAsync } from "../../lib/enterpriseSecurity/shopPinSecret";

import {

  clearShopSecurityPinOnCloud,

  saveShopSecurityPinToCloud,

} from "../../lib/shopSecurityPinSync";

import { resolveShopCtx } from "../../offline/cloudSync";



type Props = { lang: Language };



type PinStep = "verify" | "new" | "confirm";



export function BackOfficePinForm({ lang }: Props) {

  const preferences = usePosStore((s) => s.preferences);

  const setPreferences = usePosStore((s) => s.setPreferences);

  const [shopId, setShopId] = useState<string | null>(null);

  const [boPinNew, setBoPinNew] = useState("");

  const [step, setStep] = useState<PinStep>("new");

  const [boPinFeedback, setBoPinFeedback] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [resetSignal, setResetSignal] = useState(0);



  const pinActive = isShopSecurityPinConfigured(preferences.backOfficePin);



  useEffect(() => {

    void resolveShopCtx().then((ctx) => setShopId(ctx?.shopId ?? null));

  }, []);



  useEffect(() => {

    setStep(pinActive ? "verify" : "new");

  }, [pinActive]);



  const stepLabel =

    step === "verify"

      ? t(lang, "settingsBackOfficePinVerify")

      : step === "new"

        ? t(lang, "settingsBackOfficePinNew")

        : t(lang, "settingsBackOfficePinConfirm");



  return (

    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">

      {pinActive ? (

        <p className="text-sm font-semibold text-emerald-800">{t(lang, "settingsBackOfficePinActiveShort")}</p>

      ) : (

        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "settingsBackOfficePinNone")}</p>

      )}

      {boPinFeedback ? <p className="mt-2 text-sm font-bold text-waka-900">{boPinFeedback}</p> : null}

      <p className="mt-4 text-sm font-bold text-foreground">{stepLabel}</p>

      <EnterprisePinPad

        lang={lang}

        disabled={saving}

        resetSignal={`${step}-${resetSignal}`}

        className="mt-3"

        onComplete={(pin: string) => {

          if (step === "verify") {

            void verifyShopSecurityPinAsync(pin, preferences.backOfficePin).then((ok) => {

              if (!ok) {

                setBoPinFeedback(t(lang, "settingsBackOfficePinVerifyFailed"));

                setResetSignal((n) => n + 1);

                return;

              }

              setBoPinFeedback(null);

              setStep("new");

              setResetSignal((n) => n + 1);

            });

            return true;

          }

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

          if (!shopId) {

            setBoPinFeedback(t(lang, "settingsBackOfficePinOffline"));

            setResetSignal((n) => n + 1);

            return false;

          }

          setSaving(true);

          void hashShopSecurityPin(pin).then(async (hash) => {

            if (!hash) {

              setSaving(false);

              setBoPinFeedback(t(lang, "settingsBackOfficePinLength"));

              setResetSignal((n) => n + 1);

              return;

            }

            const uploaded = await saveShopSecurityPinToCloud(shopId, hash);

            if (!uploaded.ok) {

              setSaving(false);

              setBoPinFeedback(t(lang, "settingsBackOfficePinSyncFailed"));

              setResetSignal((n) => n + 1);

              return;

            }

            setPreferences({ backOfficePin: hash });

            setSaving(false);

            setBoPinNew("");

            setStep("verify");

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

          disabled={saving || !shopId}

          onClick={() => {

            if (!shopId) return;

            setSaving(true);

            void clearShopSecurityPinOnCloud(shopId).then((result) => {

              setSaving(false);

              if (!result.ok) {

                setBoPinFeedback(t(lang, "settingsBackOfficePinSyncFailed"));

                return;

              }

              setBoPinNew("");

              setStep("new");

              setResetSignal((n) => n + 1);

              setPreferences({ backOfficePin: null });

              setBoPinFeedback(t(lang, "settingsBackOfficePinCleared"));

            });

          }}

        >

          {t(lang, "settingsBackOfficePinClear")}

        </button>

      </div>

    </article>

  );

}


