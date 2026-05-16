import type { FormEvent } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { useActivation } from "../context/ActivationContext";
import { submitActivationRequest } from "../lib/businessActivation";
import { t } from "../lib/i18n";

export function BusinessActivationPage({ lang }: { lang: Language }) {
  const { gate, refresh, unlocked, bypass } = useActivation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Optimistic success immediately after POST, before gate refetch settles. */
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  const lifecycle = gate?.lifecycle ?? "inactive";
  const pending = lifecycle === "pending_review";
  const active = unlocked || lifecycle === "active";
  const showSuccess = pending || justSubmitted;
  const displayRef = gate?.reference_code ?? submittedCode;

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
    window.dispatchEvent(new Event("waka:activation-updated"));
    await refresh();
  };

  if (bypass) {
    return (
      <div className="min-h-dvh bg-[#faf9f7] px-6 py-16">
        <div className="mx-auto max-w-md pt-8">
          <p className="text-base font-medium leading-relaxed text-stone-700">{t(lang, "activationStaffBypass")}</p>
          <Link
            className="mt-8 inline-flex min-h-[52px] items-center justify-center rounded-xl bg-orange-600 px-8 text-base font-semibold text-white transition hover:bg-orange-700"
            to="/"
          >
            {t(lang, "activationContinueApp")}
          </Link>
        </div>
      </div>
    );
  }

  if (active) {
    return (
      <div className="min-h-dvh bg-[#faf9f7] px-6 py-16">
        <div className="mx-auto max-w-md space-y-6 pt-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{t(lang, "activationActiveTitle")}</h1>
          {gate?.active_license_key ? (
            <p className="font-mono text-sm text-stone-500">{gate.active_license_key}</p>
          ) : null}
          <Link
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-orange-600 text-base font-semibold text-white transition hover:bg-orange-700 sm:w-auto sm:px-10"
            to="/"
          >
            {t(lang, "activationContinueApp")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#faf9f7]">
      <div className="mx-auto flex max-w-md flex-col px-6 pb-12 pt-[max(3rem,env(safe-area-inset-top))]">
        <header className="text-center">
          <div className="mx-auto flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 text-2xl font-bold text-white shadow-sm">
            W
          </div>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            {t(lang, "activationHeroKicker")}
          </p>
          <h1 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-tight text-stone-900 sm:text-4xl">
            {t(lang, "activationPageTitle")}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">{t(lang, "activationPageSubtitle")}</p>
        </header>

        {showSuccess ? (
          <section className="mt-12 space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-100 text-orange-700">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900">{t(lang, "activationSuccessTitle")}</h2>
            <p className="text-base leading-relaxed text-stone-600">{t(lang, "activationSuccessBody")}</p>
            <p className="mx-auto max-w-sm pt-2 text-sm leading-relaxed text-stone-500">{t(lang, "activationSuccessHint")}</p>
            {displayRef ? (
              <p className="pt-2 font-mono text-xs text-stone-400">
                {t(lang, "activationRefHint").replace("{{code}}", displayRef)}
              </p>
            ) : null}
          </section>
        ) : (
          <form onSubmit={trySubmit} className="mt-12 space-y-6">
            <div>
              <label htmlFor="activation-business-name" className="block text-sm font-medium text-stone-800">
                {t(lang, "activationBusinessLabel")}
              </label>
              <input
                id="activation-business-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(lang, "activationBusinessPlaceholder")}
                autoComplete="organization"
                className="mt-2 min-h-[3.25rem] w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-900 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                required
                minLength={2}
              />
            </div>
            {submitError ? <p className="text-sm font-medium text-red-600">{submitError}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="flex min-h-[3.25rem] w-full items-center justify-center rounded-xl bg-orange-600 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
            >
              {busy ? "…" : t(lang, "activationRequestBtn")}
            </button>
          </form>
        )}

        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            to="/demo"
            className="flex min-h-[3rem] items-center justify-center rounded-xl border border-stone-200 bg-white text-center text-sm font-semibold text-stone-800 shadow-sm transition hover:border-stone-300 hover:bg-stone-50"
          >
            {t(lang, "activationTryDemo")}
          </Link>
          <Link
            to="/support"
            className="flex min-h-[3rem] items-center justify-center rounded-xl bg-stone-900 text-center text-sm font-semibold text-white transition hover:bg-stone-800"
          >
            {t(lang, "activationContactSupport")}
          </Link>
        </div>
      </div>
    </div>
  );
}
