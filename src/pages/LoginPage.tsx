import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { StaffBusinessNameField } from "../components/auth/StaffBusinessNameField";
import { t } from "../lib/i18n";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { formatAuthError } from "../lib/authConfig";
import { getGoogleOAuthClientId } from "../lib/googleIdentity";
import { hasSupabaseConfig } from "../lib/supabase";
import type { CachedShop, RememberedStaffDevice, StaffLoginInput } from "../lib/staffOfflineAuth";
import {
  STAFF_LOGIN_ROLES,
  isStaffLoginRole,
  staffLoginRoleLabel,
  type StaffLoginRole,
} from "../lib/staffLoginRoles";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  initializing: boolean;
  isAuthenticated: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  onStaffLogin: (input: StaffLoginInput) => Promise<void>;
  listStaffShops: () => Promise<CachedShop[]>;
  rememberedStaffDevice: RememberedStaffDevice | null;
  onClearRememberedStaff: () => void;
  mode: "supabase" | "local";
};

type LoginChoice = "owner" | "staff";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState(rememberedStaffDevice?.businessName ?? "");
  const [staffRole, setStaffRole] = useState<StaffLoginRole>("cashier");
  const [staffIdentifier, setStaffIdentifier] = useState(rememberedStaffDevice?.identifier ?? "");
  const [staffPin, setStaffPin] = useState("");
  const [rememberDevice, setRememberDevice] = useState(Boolean(rememberedStaffDevice));
  const [cachedShops, setCachedShops] = useState<CachedShop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [staffBusy, setStaffBusy] = useState(false);
  const [loadingShops, setLoadingShops] = useState(false);
  const [staffRedirecting, setStaffRedirecting] = useState(false);

  const businessSuggestions = useMemo(
    () => cachedShops.map((s) => ({ id: s.accountKey, label: s.businessName })),
    [cachedShops],
  );

  if (isAuthenticated && !staffRedirecting) {
    return <Navigate to="/" replace />;
  }

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

  const canOwnerSignIn = mode === "supabase" || mode === "local";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(email, password);
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
        identifier: staffIdentifier,
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
              <p className="text-xs font-medium text-waka-800/80">Owner or admin account</p>
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
              <p className="text-xs font-medium text-stone-600">Cashier, manager, stock keeper, supervisor</p>
            </button>
          </div>
        ) : null}

        {choice === "owner" && mode === "local" ? (
          <p className="mt-3 rounded-xl bg-stone-100 px-3 py-2 text-xs font-medium text-stone-700">{t(lang, "supabaseRegisterHint")}</p>
        ) : null}

        {choice === "owner" ? (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "supabase" && hasSupabaseConfig ? (
              getGoogleOAuthClientId() ? (
                <>
                  <GoogleSignInButton lang={lang} busy={googleBusy} onClick={googleSubmit} />
                  <p className="text-[11px] font-medium text-stone-400">{t(lang, "googleOAuthBrandingNote")}</p>
                </>
              ) : (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                  {t(lang, "googleClientIdMissing")}
                </p>
              )
            ) : null}

            <label className="block text-sm font-medium">
              {t(lang, "email")}
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border px-3 py-2.5 outline-none ring-waka-200 focus:ring"
              />
            </label>

            <div className="flex items-center justify-between text-sm">
              <label className="font-medium">{t(lang, "password")}</label>
              {mode === "supabase" && hasSupabaseConfig ? (
                <Link to="/forgot-password" className="font-medium text-waka-700 underline underline-offset-2">
                  {t(lang, "forgotPassword")}
                </Link>
              ) : null}
            </div>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-xl border px-3 py-2.5 outline-none ring-waka-200 focus:ring"
            />

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              disabled={busy}
              type="submit"
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm transition-waka active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100"
            >
              {busy ? "…" : "Sign in to your shop"}
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

            <label className="block text-sm font-medium">
              {t(lang, "staffLoginSelectRole")}
              <select
                value={staffRole}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isStaffLoginRole(v)) setStaffRole(v);
                }}
                className="mt-1 w-full rounded-xl border px-3 py-2.5 text-base outline-none ring-waka-200 focus:ring"
              >
                {STAFF_LOGIN_ROLES.map((r) => (
                  <option value={r} key={r}>
                    {staffLoginRoleLabel(r)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium">
              {t(lang, "staffLoginIdentifier")}
              <input
                value={staffIdentifier}
                onChange={(e) => setStaffIdentifier(e.target.value)}
                required
                autoComplete="username"
                className="mt-1 w-full rounded-xl border px-3 py-2.5 text-base outline-none ring-waka-200 focus:ring"
                placeholder="cashier01"
              />
            </label>

            <label className="block text-sm font-medium">
              {t(lang, "staffLoginPin")}
              <input
                type="password"
                value={staffPin}
                onChange={(e) => setStaffPin(e.target.value)}
                required
                autoComplete="current-password"
                className="mt-1 w-full rounded-xl border px-3 py-2.5 text-base outline-none ring-waka-200 focus:ring"
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
              disabled={staffBusy}
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
