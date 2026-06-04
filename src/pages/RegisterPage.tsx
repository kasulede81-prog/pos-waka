import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { t } from "../lib/i18n";
import { formatAuthError } from "../lib/authConfig";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import type { SignUpResult } from "../hooks/useAuth";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";
import { storePendingReferralCode } from "../lib/pendingReferral";
import { normalizeReferralCode, validateReferralCode } from "../lib/referralAgents";
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";
import { tTemplate } from "../lib/i18n";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
  signUpQuick: (input: {
    shopName: string;
    ownerName: string;
    email: string;
    phone: string;
    districtId: string;
    password: string;
    referralCode?: string;
  }) => Promise<SignUpResult>;
  onGoogleSignIn: (opts?: { referralCode?: string }) => Promise<void>;
};

const fieldClass =
  "mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2";

export function RegisterPage({ lang, setLang, isAuthenticated, signUpQuick, onGoogleSignIn }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(hasSupabaseConfig);
  const [districtsError, setDistrictsError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(() => searchParams.get("ref")?.trim().toUpperCase() ?? "");
  const [referralHint, setReferralHint] = useState<string | null>(null);
  const [referralValidating, setReferralValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const showGoogle = hasSupabaseConfig && isGoogleAuthUiAvailable();

  const loadDistricts = useCallback(async () => {
    setDistrictsLoading(true);
    setDistrictsError(null);
    try {
      const { districts: d, error: err } = await fetchDistricts();
      setDistricts(d);
      if (err) setDistrictsError(err);
    } finally {
      setDistrictsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ref = searchParams.get("ref")?.trim();
    if (ref) {
      const code = ref.toUpperCase();
      setReferralCode(code);
      storePendingReferralCode(code);
    }
  }, [searchParams]);

  const validateReferralField = useCallback(
    async (raw: string): Promise<boolean> => {
      const trimmed = normalizeReferralCode(raw);
      if (!trimmed) {
        setReferralHint(null);
        return true;
      }
      setReferralValidating(true);
      const res = await validateReferralCode(trimmed);
      setReferralValidating(false);
      if (!res.ok) {
        setReferralHint(t(lang, "registerReferralInvalid"));
        return false;
      }
      setReferralHint(
        res.agentName ? tTemplate(lang, "registerReferralValid", { name: res.agentName }) : null,
      );
      if (res.referralCode) setReferralCode(res.referralCode);
      return true;
    },
    [lang],
  );

  useEffect(() => {
    if (hasSupabaseConfig) void loadDistricts();
  }, [loadDistricts]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailNorm = email.trim().toLowerCase();
    if (!shopName.trim() || !ownerName.trim() || !emailNorm) {
      setError(t(lang, "registerFieldRequired"));
      return;
    }
    if (!emailNorm.includes("@") || !emailNorm.includes(".")) {
      setError(t(lang, "registerEmailInvalid"));
      return;
    }
    if (password.length < 8) {
      setError(t(lang, "passwordTooShort"));
      return;
    }
    if (!normalizeUgPhoneE164(phone)) {
      setError(t(lang, "registerPhoneInvalid"));
      return;
    }
    if (!districtId) {
      setError(t(lang, "businessProfileDistrictRequired"));
      return;
    }
    if (referralCode.trim()) {
      const ok = await validateReferralField(referralCode);
      if (!ok) {
        setError(t(lang, "registerReferralInvalid"));
        return;
      }
    }
    setBusy(true);
    try {
      const result = await signUpQuick({
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        email: emailNorm,
        phone: phone.trim(),
        districtId,
        password,
        referralCode: referralCode.trim() || undefined,
      });
      if (referralCode.trim()) storePendingReferralCode(referralCode.trim());
      if (result.needsEmailVerification) {
        navigate("/verify-email", { replace: true, state: { email: emailNorm } });
        return;
      }
      navigate("/onboarding", { replace: true });
    } catch (err) {
      const msg = (err as Error).message || "";
      const lower = msg.toLowerCase();
      if (
        lower.includes("database error saving new user") ||
        lower.includes("could not finish creating your shop")
      ) {
        setError(t(lang, "signupWorkspaceError"));
      } else {
        setError(formatAuthError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const googleSubmit = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      const code = referralCode.trim() || searchParams.get("ref")?.trim();
      await onGoogleSignIn(code ? { referralCode: code } : undefined);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setGoogleBusy(false);
    }
  };

  if (isAuthenticated) return <Navigate to="/onboarding" replace />;

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="mx-auto max-w-md rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
        <h1 className="text-2xl font-black text-stone-900">{t(lang, "registerQuickTitle")}</h1>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "registerQuickSub")}</p>

        {!hasSupabaseConfig ? (
          <div className="mt-6 space-y-3">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{t(lang, "supabaseMissing")}</p>
            <p className="text-sm text-slate-600">{t(lang, "supabaseRegisterHint")}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {showGoogle ? (
              <>
                <GoogleSignInButton lang={lang} busy={googleBusy} onClick={googleSubmit} />
                <div className="flex items-center gap-3 py-0.5" aria-hidden>
                  <span className="h-px flex-1 bg-stone-200" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">or</span>
                  <span className="h-px flex-1 bg-stone-200" />
                </div>
              </>
            ) : null}

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerShopNameLabel")}
              <input
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                required
                autoComplete="organization"
                placeholder={t(lang, "registerShopNamePh")}
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerOwnerFullNameLabel")}
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                required
                autoComplete="name"
                placeholder="Kasule Denis"
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerEmailLabel")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder={t(lang, "registerEmailPh")}
                className={fieldClass}
              />
            </label>
            <p className="text-xs font-medium text-stone-500">{t(lang, "registerEmailRequiredHint")}</p>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerPhoneLabel")}
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                required
                placeholder="07XXXXXXXX"
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerDistrictLabel")}
              <select
                value={districtId}
                onChange={(e) => setDistrictId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">—</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {districts.length === 0 ? (
              <p className="text-xs font-semibold text-stone-600">
                {districtsError
                  ? `${t(lang, "registerDistrictsLoadFailed")} ${districtsError}`
                  : t(lang, "registerDistrictsLoading")}
                {" "}
                <button type="button" className="font-bold text-waka-700 underline" onClick={() => void loadDistricts()}>
                  {t(lang, "registerDistrictsRetry")}
                </button>
              </p>
            ) : null}

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "password")}
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className={fieldClass}
              />
            </label>

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerReferralLabel")}
              <input
                value={referralCode}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase());
                  setReferralHint(null);
                }}
                onBlur={() => void validateReferralField(referralCode)}
                placeholder={t(lang, "registerReferralPh")}
                autoComplete="off"
                className="mt-1.5 w-full rounded-xl border border-stone-200 px-4 py-3 font-mono text-base uppercase outline-none ring-waka-200 focus:border-waka-400 focus:ring-2"
              />
            </label>
            <p className="text-xs font-medium text-stone-500">{t(lang, "registerReferralHint")}</p>
            {referralValidating ? <p className="text-xs font-semibold text-stone-500">…</p> : null}
            {referralHint ? (
              <p
                className={`text-xs font-semibold ${referralHint === t(lang, "registerReferralInvalid") ? "text-red-600" : "text-emerald-800"}`}
              >
                {referralHint}
              </p>
            ) : null}

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              disabled={busy || districtsLoading || districts.length === 0}
              type="submit"
              className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50"
            >
              {busy ? "…" : t(lang, "createAccount")}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link to="/login" className="font-bold text-waka-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
