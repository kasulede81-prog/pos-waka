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
  const [msg, setMsg] = useState<string | null>(null);

  const lifecycle = gate?.lifecycle ?? "inactive";
  const pending = lifecycle === "pending_review";
  const active = unlocked || lifecycle === "active";

  const trySubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const r = await submitActivationRequest(name);
    setBusy(false);
    if (!r.ok) setMsg(r.message ?? "Could not submit.");
    else {
      setMsg(`${t(lang, "activationRequestSubmitted")}: ${r.code}`);
      setName("");
      window.dispatchEvent(new Event("waka:activation-updated"));
      await refresh();
    }
  };

  if (bypass) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <p className="text-lg font-semibold text-stone-700">{t(lang, "activationStaffBypass")}</p>
        <Link className="mt-6 inline-flex rounded-2xl bg-orange-600 px-6 py-3 font-black text-white" to="/">
          {t(lang, "activationContinueApp")}
        </Link>
      </div>
    );
  }

  if (active) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-inner">
          <p className="text-xs font-black uppercase tracking-widest text-emerald-800">{t(lang, "activationStatusChip")}</p>
          <p className="mt-3 text-2xl font-black text-emerald-950">{t(lang, "activationActiveTitle")}</p>
          {gate?.active_license_key ? (
            <p className="mt-4 font-mono text-sm font-bold text-emerald-900">{gate.active_license_key}</p>
          ) : null}
          <Link className="mt-8 inline-flex rounded-2xl bg-orange-600 px-8 py-4 text-lg font-black text-white shadow-lg" to="/">
            {t(lang, "activationContinueApp")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-8 px-4 py-[max(2rem,env(safe-area-inset-top))] pb-16">
      <header className="space-y-2 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-700 text-3xl font-black text-white shadow-lg">
          W
        </div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">{t(lang, "brandShortTag")}</p>
        <h1 className="text-3xl font-black text-stone-950">{t(lang, "activationPageTitle")}</h1>
        <p className="text-base font-medium text-stone-600">{t(lang, "activationPageSubtitle")}</p>
      </header>

      <div className="rounded-3xl border-2 border-stone-100 bg-white p-6 shadow-waka-sm">
        <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "activationStatusChip")}</p>
        <p className="mt-2 text-xl font-black text-stone-900">
          {pending ? t(lang, "activationPendingHeadline") : t(lang, "activationNeedsRequestHeadline")}
        </p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-stone-600">
          {pending ? t(lang, "activationPendingBody") : t(lang, "activationNeedsRequestBody")}
        </p>
        {pending && gate?.reference_code ? (
          <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 font-mono text-lg font-black text-orange-950">{gate.reference_code}</p>
        ) : null}
      </div>

      {!pending ? (
        <form onSubmit={trySubmit} className="space-y-4 rounded-3xl border-2 border-orange-100 bg-gradient-to-b from-orange-50/70 to-white p-6 shadow-inner">
          <label className="block">
            <span className="text-sm font-bold text-stone-800">{t(lang, "activationBusinessLabel")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, "activationBusinessPlaceholder")}
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-lg font-semibold outline-none ring-orange-200 focus:ring"
              required
              minLength={2}
            />
          </label>
          {msg ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">{msg}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[54px] rounded-2xl bg-orange-600 py-3 text-lg font-black text-white shadow-md disabled:opacity-60"
          >
            {busy ? "…" : t(lang, "activationGenerateCode")}
          </button>
        </form>
      ) : (
        <>
          {msg ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-900">{msg}</p> : null}
        </>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          to="/demo"
          className="flex flex-1 items-center justify-center rounded-2xl border-2 border-orange-200 bg-white px-4 py-4 text-center text-sm font-black text-orange-950"
        >
          {t(lang, "activationTryDemo")}
        </Link>
        <Link
          to="/support"
          className="flex flex-1 items-center justify-center rounded-2xl bg-stone-900 px-4 py-4 text-center text-sm font-black text-white"
        >
          {t(lang, "activationContactSupport")}
        </Link>
      </div>

      <p className="text-center text-xs font-medium text-stone-500">{t(lang, "activationFinePrint")}</p>
    </div>
  );
}
