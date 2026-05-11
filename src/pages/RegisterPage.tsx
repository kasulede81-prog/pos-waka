import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { BusinessType, Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";
import type { SignUpResult } from "../hooks/useAuth";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
  signUp: (email: string, password: string, businessName: string, businessType: BusinessType) => Promise<SignUpResult>;
  onGoogleSignIn: () => Promise<void>;
};

export function RegisterPage({ lang, setLang, isAuthenticated, signUp, onGoogleSignIn }: Props) {
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("kiosk_duka");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!businessName.trim()) {
      setError(t(lang, "shopNameRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t(lang, "passwordTooShort"));
      return;
    }
    setBusy(true);
    try {
      const result = await signUp(email, password, businessName.trim(), businessType);
      if (result.needsEmailVerification) navigate("/verify-email", { replace: true, state: { email } });
      else navigate("/", { replace: true });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("[waka-auth] register submit failed", err);
      }
      const msg = (err as Error).message || "";
      if (msg.toLowerCase().includes("database error saving new user")) {
        setError(t(lang, "signupWorkspaceError"));
      } else {
        setError(msg || t(lang, "signupWorkspaceError"));
      }
    } finally {
      setBusy(false);
    }
  };

  const googleSubmit = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await onGoogleSignIn();
    } catch (err) {
      setError((err as Error).message || t(lang, "signupWorkspaceError"));
    } finally {
      setGoogleBusy(false);
    }
  };

  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t(lang, "registerTitle")}</h1>

        {!hasSupabaseConfig ? (
          <div className="mt-6 space-y-3">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{t(lang, "supabaseMissing")}</p>
            <p className="text-sm text-slate-600">{t(lang, "supabaseRegisterHint")}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <button
              type="button"
              onClick={googleSubmit}
              disabled={googleBusy}
              className="min-h-[52px] w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-base font-black text-stone-900 shadow-sm"
            >
              {googleBusy ? "…" : t(lang, "continueWithGoogle")}
            </button>
            <label className="block text-sm font-medium">
              {t(lang, "businessName")}
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
              />
            </label>
            <div>
              <p className="block text-sm font-medium">{t(lang, "registerBusinessTypeLabel")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {BUSINESS_TYPE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBusinessType(id)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                      businessType === id ? "border-waka-500 bg-waka-50 text-waka-900" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {t(lang, `businessType_${id}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-sm font-medium">
              {t(lang, "email")}
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "password")}
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
              />
            </label>
            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
            <button disabled={busy} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">
              {busy ? "…" : t(lang, "createAccount")}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link to="/login" className="font-medium text-waka-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
