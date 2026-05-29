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
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";

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
  onGoogleSignIn: () => Promise<void>;
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
  const [districtsError, setDistrictsError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(() => searchParams.get("ref")?.trim().toUpperCase() ?? "");
  const [agentOpen, setAgentOpen] = useState(Boolean(searchParams.get("ref")));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const showGoogle = hasSupabaseConfig && isGoogleAuthUiAvailable();

  const loadDistricts = useCallback(async () => {
    setDistrictsError(null);
    const { districts: d, error: err } = await fetchDistricts();
    setDistricts(d);
    if (err) setDistrictsError(err);
  }, []);

  useEffect(() => {
    const ref = searchParams.get("ref")?.trim();
    if (ref) {
      setReferralCode(ref.toUpperCase());
      setAgentOpen(true);
    }
  }, [searchParams]);

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
      if (result.needsEmailVerification) {
        navigate("/login", { replace: true, state: { registeredPhone: phone } });
        return;
      }
      navigate("/onboarding", { replace: true });
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.toLowerCase().includes("database error saving new user")) {
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
      await onGoogleSignIn();
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

            <details
              className="rounded-xl border border-stone-100 bg-stone-50/60"
              open={agentOpen}
              onToggle={(e) => setAgentOpen(e.currentTarget.open)}
            >
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-black text-stone-700">{t(lang, "registerAgentToggle")}</summary>
              <div className="border-t border-stone-100 px-3 pb-3 pt-2">
                <input
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder={t(lang, "registerAgentPh")}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 font-mono text-sm uppercase outline-none ring-waka-200 focus:ring-2"
                />
              </div>
            </details>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              disabled={busy}
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
