import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { StaffBusinessNameField } from "../components/auth/StaffBusinessNameField";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { t } from "../lib/i18n";
import { formatAuthError } from "../lib/authConfig";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import type { CachedShop, RememberedStaffDevice, StaffLoginInput } from "../lib/staffOfflineAuth";
import type { StaffLoginRole } from "../lib/staffLoginRoles";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  initializing: boolean;
  isAuthenticated: boolean;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  onStaffLogin: (input: StaffLoginInput) => Promise<void>;
  listStaffShops: () => Promise<CachedShop[]>;
  rememberedStaffDevice: RememberedStaffDevice | null;
  onClearRememberedStaff: () => void;
  mode: "supabase" | "local";
};

type LoginChoice = "owner" | "staff";
type OwnerLoginMethod = "email" | "phone";

const ownerInputClass =
  "mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2";

export function LoginPage({
  lang,
  setLang,
  initializing,
  isAuthenticated,
  onLogin,
  onGoogleLogin,
  onStaffLogin,
  listStaffShops,
  rememberedStaffDevice,
  onClearRememberedStaff,
  mode,
}: Props) {
  const [choice, setChoice] = useState<LoginChoice | null>(null);
  const [ownerMethod, setOwnerMethod] = useState<OwnerLoginMethod>("phone");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState(rememberedStaffDevice?.businessName ?? "");
  const staffRole: StaffLoginRole = "cashier";
  const [staffName, setStaffName] = useState(rememberedStaffDevice?.identifier ?? "");
  const [staffPin, setStaffPin] = useState("");
  const [rememberDevice, setRememberDevice] = useState(Boolean(rememberedStaffDevice));
  const [cachedShops, setCachedShops] = useState<CachedShop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [staffBusy, setStaffBusy] = useState(false);
  const [loadingShops, setLoadingShops] = useState(false);
  const [staffRedirecting, setStaffRedirecting] = useState(false);

  const showGoogle = mode === "supabase" && hasSupabaseConfig && isGoogleAuthUiAvailable();

  const businessSuggestions = useMemo(
    () => cachedShops.map((s) => ({ id: s.accountKey, label: s.businessName })),
    [cachedShops],
  );

  useEffect(() => {
    if (choice !== "staff") return;
    let cancelled = false;
    setLoadingShops(true);
    void listStaffShops()
      .then((rows) => {
        if (!cancelled) setCachedShops(rows);
      })
      .finally(() => {
        if (!cancelled) setLoadingShops(false);
      });
    return () => {
      cancelled = true;
    };
  }, [choice, listStaffShops]);

  if (isAuthenticated && !staffRedirecting) {
    return <Navigate to="/" replace />;
  }

  const canOwnerSignIn = mode === "supabase" || mode === "local";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(identifier, password);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitStaff = async (e: FormEvent) => {
    e.preventDefault();
    setStaffBusy(true);
    setStaffRedirecting(true);
    setError(null);
    try {
      await onStaffLogin({
        businessName,
        role: staffRole,
        identifier: staffName.trim(),
        pinOrPassword: staffPin,
        rememberDevice,
      });
    } catch (err) {
      setStaffRedirecting(false);
      setError(formatAuthError(err));
    } finally {
      setStaffBusy(false);
    }
  };

  const googleSubmit = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await onGoogleLogin();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setGoogleBusy(false);
    }
  };

  if (initializing) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="h-10 w-40 rounded-xl waka-skeleton-bar" />
          <p className="text-center text-sm font-medium text-stone-600">{t(lang, "loadingAuth")}</p>
        </div>
      </AuthLayout>
    );
  }

  if (staffRedirecting) {
    return (
      <AuthLayout lang={lang} setLang={setLang}>
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="h-10 w-40 animate-pulse rounded-xl bg-orange-100" />
          <p className="text-center text-sm font-semibold text-stone-700">{t(lang, "staffLoginOpening")}</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
        <h1 className="text-2xl font-black text-stone-900">Welcome to Waka POS</h1>
        <p className="mt-2 text-sm font-medium text-stone-600">Choose how you want to access your shop.</p>

        {!choice ? (
          <div className="mt-6 space-y-3">
            <button
              type="button"
              className="min-h-[60px] w-full rounded-2xl border-2 border-waka-200 bg-orange-50 px-4 text-left shadow-sm transition active:scale-[0.99]"
              onClick={() => {
                setChoice("owner");
                setError(null);
              }}
            >
              <p className="text-lg font-black text-waka-900">Sign in to your shop</p>
              <p className="text-xs font-medium text-waka-800/80">Owner or admin · email or phone</p>
            </button>
            <button
              type="button"
              className="min-h-[60px] w-full rounded-2xl border-2 border-stone-200 bg-white px-4 text-left shadow-sm transition active:scale-[0.99]"
              onClick={() => {
                setChoice("staff");
                setError(null);
              }}
            >
              <p className="text-lg font-black text-stone-900">Sign in as staff</p>
              <p className="text-xs font-medium text-stone-600">Cashier, manager, or stock keeper</p>
            </button>
          </div>
        ) : null}

        {choice === "owner" && mode === "local" ? (
          <p className="mt-3 rounded-xl bg-stone-100 px-3 py-2 text-xs font-medium text-stone-700">{t(lang, "supabaseRegisterHint")}</p>
        ) : null}

        {choice === "owner" ? (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "supabase" && hasSupabaseConfig ? (
              <p className="text-xs font-medium text-stone-500">{t(lang, "loginOwnerHint")}</p>
            ) : null}

            {showGoogle ? (
              <>
                <GoogleSignInButton lang={lang} busy={googleBusy} onClick={googleSubmit} />
                <div className="flex items-center gap-3 py-1" aria-hidden>
                  <span className="h-px flex-1 bg-stone-200" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">or</span>
                  <span className="h-px flex-1 bg-stone-200" />
                </div>
              </>
            ) : null}

            {mode === "supabase" && hasSupabaseConfig ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1">
                <button
                  type="button"
                  onClick={() => setOwnerMethod("phone")}
                  className={`min-h-[44px] rounded-lg text-sm font-black transition ${
                    ownerMethod === "phone" ? "bg-white text-waka-900 shadow-sm" : "text-stone-600"
                  }`}
                >
                  {t(lang, "loginOwnerMethodPhone")}
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerMethod("email")}
                  className={`min-h-[44px] rounded-lg text-sm font-black transition ${
                    ownerMethod === "email" ? "bg-white text-waka-900 shadow-sm" : "text-stone-600"
                  }`}
                >
                  {t(lang, "loginOwnerMethodEmail")}
                </button>
              </div>
            ) : null}

            <label className="block text-sm font-bold text-stone-800">
              {ownerMethod === "phone" && mode === "supabase" ? t(lang, "registerPhoneLabel") : t(lang, "email")}
              <input
                type={ownerMethod === "phone" && mode === "supabase" ? "tel" : "email"}
                inputMode={ownerMethod === "phone" && mode === "supabase" ? "tel" : "email"}
                autoComplete={ownerMethod === "phone" && mode === "supabase" ? "tel" : "email"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder={ownerMethod === "phone" && mode === "supabase" ? "07XXXXXXXX" : undefined}
                className={ownerInputClass}
              />
            </label>

            <label className="block text-sm font-bold text-stone-800">
              <span className="flex items-center justify-between gap-2">
                {t(lang, "password")}
                {mode === "supabase" && hasSupabaseConfig ? (
                  <Link to="/forgot-password" className="text-xs font-semibold text-waka-700 underline underline-offset-2">
                    {t(lang, "forgotPassword")}
                  </Link>
                ) : null}
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={ownerInputClass}
              />
            </label>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              disabled={busy}
              type="submit"
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm transition-waka active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
            >
              {busy ? "…" : t(lang, "signIn")}
            </button>
          </form>
        ) : null}

        {choice === "staff" ? (
          <form onSubmit={submitStaff} className="mt-6 space-y-4">
            <StaffBusinessNameField
              label={t(lang, "staffLoginBusinessName")}
              placeholder="Nabukalu Wholesale"
              value={businessName}
              onChange={setBusinessName}
              suggestions={businessSuggestions}
              loading={loadingShops}
              hint={loadingShops ? t(lang, "staffLoginLoadingShops") : t(lang, "staffLoginBusinessHint")}
            />

            <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600">
              {t(lang, "staffLoginRoleAutoHint")}
            </p>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "staffLoginName")}
              <input
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                required
                autoComplete="name"
                className={ownerInputClass}
                placeholder={t(lang, "staffLoginNamePh")}
              />
            </label>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "staffLoginPin")}
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={staffPin}
                onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                required
                autoComplete="off"
                className={`${ownerInputClass} text-center font-mono text-2xl tracking-[0.35em]`}
                placeholder={t(lang, "staffLoginPinPlaceholder")}
              />
            </label>

            <label className="flex min-h-[48px] items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
              />
              {t(lang, "staffLoginRememberDevice")}
            </label>
            {rememberedStaffDevice ? (
              <button
                type="button"
                onClick={onClearRememberedStaff}
                className="text-xs font-semibold text-stone-500 underline underline-offset-2"
              >
                {t(lang, "staffLoginClearRemembered")}
              </button>
            ) : null}

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              disabled={staffBusy || !businessName.trim() || !staffName.trim() || staffPin.length !== 4}
              type="submit"
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm transition-waka active:scale-[0.99] disabled:opacity-50"
            >
              {staffBusy ? "…" : t(lang, "staffLoginSubmit")}
            </button>
          </form>
        ) : null}

        {choice ? (
          <button
            type="button"
            className="mt-4 min-h-[44px] text-sm font-semibold text-stone-600 underline underline-offset-2"
            onClick={() => {
              setChoice(null);
              setError(null);
            }}
          >
            {t(lang, "staffLoginBack")}
          </button>
        ) : null}

        <div className="mt-6 rounded-2xl bg-stone-50 p-4 text-center ring-1 ring-stone-100">
          <p className="text-sm font-medium text-stone-600">{t(lang, "haveAccount")}</p>
          <Link
            to="/register"
            className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-900 shadow-sm transition-waka active:bg-stone-50"
          >
            {t(lang, "createAccount")}
          </Link>
        </div>

        {!hasSupabaseConfig && canOwnerSignIn && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{t(lang, "supabaseMissing")}</p>
        )}

        <p className="mt-8 text-center">
          <Link
            to="/support"
            className="inline-flex min-h-[48px] items-center justify-center text-base font-bold text-waka-800 underline underline-offset-2"
          >
            {t(lang, "supportLoginFooter")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

