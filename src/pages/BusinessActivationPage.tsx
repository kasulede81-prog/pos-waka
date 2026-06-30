import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { useActivation } from "../context/ActivationContext";
import { useBusinessBuilder } from "../context/BusinessBuilderContext";
import { BusinessBuilderShell } from "../components/businessBuilder/BusinessBuilderShell";
import { BuilderField, BuilderPrimaryButton } from "../components/businessBuilder/BuilderField";
import { registrationUnlocks } from "../lib/businessBuilder/businessSceneState";
import { submitActivationRequest } from "../lib/businessActivation";
import { t } from "../lib/i18n";

type Props = { lang: Language; setLang: (lg: Language) => void };

export function BusinessActivationPage({ lang, setLang }: Props) {
  const { gate, refresh, unlocked, bypass } = useActivation();
  const { scene, patchScene } = useBusinessBuilder();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  const lifecycle = gate?.lifecycle ?? "inactive";
  const pending = lifecycle === "pending_review";
  const active = unlocked || lifecycle === "active";
  const showSuccess = pending || justSubmitted;
  const displayRef = gate?.reference_code ?? submittedCode;

  useEffect(() => {
    if (active) {
      patchScene({ activationMode: "active", isOpen: true, hasWakaBadge: true });
    } else if (showSuccess) {
      patchScene({ activationMode: "opening_soon" });
    } else {
      patchScene({ activationMode: "opening_soon" });
    }
  }, [active, showSuccess, patchScene]);

  const unlocks = useMemo(() => registrationUnlocks(scene), [scene]);

  const trySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setBusy(true);
    const r = await submitActivationRequest(name);
    setBusy(false);
    if (!r.ok) {
      setSubmitError(r.message ?? t(lang, "activationErrorGeneric"));
      return;
    }
    setSubmittedCode(r.code);
    setJustSubmitted(true);
    setName("");
    patchScene({ activationMode: "opening_soon", shopName: name.trim() || scene.shopName });
    window.dispatchEvent(new Event("waka:activation-updated"));
    await refresh();
  };

  if (bypass) {
    return (
      <BusinessBuilderShell lang={lang} setLang={setLang} funnelStep="open" unlocks={unlocks} showProgress={false}>
        <div className="rounded-[28px] bg-white p-6 shadow-lg">
          <p className="text-base font-medium leading-relaxed text-stone-700">{t(lang, "activationStaffBypass")}</p>
          <Link
            className="mt-8 inline-flex min-h-[52px] w-full items-center justify-center rounded-[28px] bg-gradient-to-r from-waka-500 to-waka-600 text-base font-semibold text-white"
            to="/"
          >
            {t(lang, "activationContinueApp")}
          </Link>
        </div>
      </BusinessBuilderShell>
    );
  }

  if (active) {
    return (
      <BusinessBuilderShell lang={lang} setLang={setLang} funnelStep="open" unlocks={unlocks}>
        <div className="space-y-6 rounded-[28px] bg-white p-6 text-center shadow-lg">
          <h1 className="text-3xl font-black tracking-tight text-stone-900">{t(lang, "activationActiveTitle")}</h1>
          {gate?.active_license_key ? (
            <p className="font-mono text-sm text-stone-500">{gate.active_license_key}</p>
          ) : null}
          <Link
            to="/"
            className="flex min-h-[52px] w-full items-center justify-center rounded-[28px] bg-gradient-to-r from-waka-500 to-waka-600 text-base font-black text-white shadow-lg"
          >
            {t(lang, "activationContinueApp")}
          </Link>
        </div>
      </BusinessBuilderShell>
    );
  }

  return (
    <BusinessBuilderShell lang={lang} setLang={setLang} funnelStep="open" unlocks={unlocks}>
      <div className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-lg backdrop-blur-sm sm:rounded-[32px]">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-waka-600">
          {t(lang, "activationHeroKicker")}
        </p>
        <h1 className="mt-3 text-2xl font-black leading-tight text-stone-900 sm:text-3xl">
          {t(lang, "activationPageTitle")}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-stone-600">{t(lang, "activationPageSubtitle")}</p>

        {showSuccess ? (
          <section className="mt-8 space-y-4 text-center">
            <h2 className="text-xl font-black text-stone-900">{t(lang, "activationSuccessTitle")}</h2>
            <p className="text-base leading-relaxed text-stone-600">{t(lang, "activationSuccessBody")}</p>
            <p className="text-sm leading-relaxed text-stone-500">{t(lang, "activationSuccessHint")}</p>
            {displayRef ? (
              <p className="font-mono text-xs text-stone-400">
                {t(lang, "activationRefHint").replace("{{code}}", displayRef)}
              </p>
            ) : null}
          </section>
        ) : (
          <form onSubmit={trySubmit} className="mt-8 space-y-5">
            <BuilderField
              id="activation-business-name"
              label={t(lang, "activationBusinessLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "activationBusinessPlaceholder")}
              autoComplete="organization"
              required
              minLength={2}
              complete={name.trim().length >= 2}
            />
            {submitError ? <p className="text-sm font-medium text-red-600">{submitError}</p> : null}
            <BuilderPrimaryButton type="submit" disabled={busy}>
              {busy ? "…" : t(lang, "activationRequestBtn")}
            </BuilderPrimaryButton>
          </form>
        )}

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            to="/demo"
            className="flex min-h-[48px] items-center justify-center rounded-2xl border border-stone-200 bg-white text-center text-sm font-semibold text-stone-800 shadow-sm"
          >
            {t(lang, "activationTryDemo")}
          </Link>
          <Link
            to="/support"
            className="flex min-h-[48px] items-center justify-center rounded-2xl bg-stone-900 text-center text-sm font-semibold text-white"
          >
            {t(lang, "activationContactSupport")}
          </Link>
        </div>
      </div>
    </BusinessBuilderShell>
  );
}
