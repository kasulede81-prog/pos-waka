import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { BusinessType, Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { formatAuthError } from "../lib/authConfig";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import type { SignUpProfileMeta, SignUpResult } from "../hooks/useAuth";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";
import { DeviceLocationRequestError, getDevicePosition } from "../lib/deviceLocation";

type Props = {
  lang: Language;
  setLang: (lg: Language) => void;
  isAuthenticated: boolean;
  signUp: (
    email: string,
    password: string,
    organizationName: string,
    businessType: BusinessType,
    profile?: SignUpProfileMeta,
  ) => Promise<SignUpResult>;
  onGoogleSignIn: () => Promise<void>;
};

export function RegisterPage({ lang, setLang, isAuthenticated, signUp, onGoogleSignIn }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [organizationName, setOrganizationName] = useState("");
  const [shopDisplayName, setShopDisplayName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [currency, setCurrency] = useState("UGX");
  const [gpsSkipped, setGpsSkipped] = useState(false);
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtsError, setDistrictsError] = useState<string | null>(null);
  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("kiosk_duka");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const showGoogle = hasSupabaseConfig && isGoogleAuthUiAvailable();
  const [referralCode, setReferralCode] = useState(() => searchParams.get("ref")?.trim().toUpperCase() ?? "");

  useEffect(() => {
    const ref = searchParams.get("ref")?.trim();
    if (ref) setReferralCode(ref.toUpperCase());
  }, [searchParams]);

  const loadDistricts = useCallback(async () => {
    setDistrictsLoading(true);
    setDistrictsError(null);
    const { districts: d, error } = await fetchDistricts();
    setDistricts(d);
    setDistrictsError(error);
    setDistrictsLoading(false);
    if (!d.length) setDistrictId("");
    else setDistrictId((cur) => (cur && d.some((x) => x.id === cur) ? cur : ""));
  }, []);

  useEffect(() => {
    void loadDistricts();
  }, [loadDistricts]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!organizationName.trim() || !shopDisplayName.trim()) {
      setError(t(lang, "shopNameRequired"));
      return;
    }
    if (!ownerFullName.trim()) {
      setError(t(lang, "registerFieldRequired"));
      return;
    }
    if (!districts.length) {
      setError(t(lang, "registerDistrictsEmptyHint"));
      return;
    }
    if (!districtId) {
      setError(t(lang, "registerFieldRequired"));
      return;
    }
    const normalized = normalizeUgPhoneE164(phone);
    if (!normalized) {
      setError(t(lang, "registerPhoneInvalid"));
      return;
    }
    if (!currency.trim() || currency.trim().length !== 3) {
      setError(t(lang, "registerFieldRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t(lang, "passwordTooShort"));
      return;
    }
    if (!gpsSkipped && (latitude == null || longitude == null)) {
      setError(t(lang, "registerFieldRequired"));
      return;
    }
    setBusy(true);
    try {
      const profile: SignUpProfileMeta = {
        fullName: ownerFullName.trim(),
        phone,
        districtId,
        organizationName: organizationName.trim(),
        shopDisplayName: shopDisplayName.trim(),
        defaultCurrency: currency.trim().toUpperCase(),
        gpsSkipped,
        latitude: !gpsSkipped && latitude != null ? latitude : undefined,
        longitude: !gpsSkipped && longitude != null ? longitude : undefined,
        referralCode: referralCode.trim() || undefined,
      };
      const result = await signUp(email, password, organizationName.trim(), businessType, profile);
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
      setError(formatAuthError(err));
    } finally {
      setGoogleBusy(false);
    }
  };

  const captureGps = () => {
    setError(null);
    void (async () => {
      try {
        const pos = await getDevicePosition();
        setLatitude(pos.latitude);
        setLongitude(pos.longitude);
        setGpsSkipped(false);
      } catch (err) {
        if (err instanceof DeviceLocationRequestError && err.reason === "unsupported") {
          setError(t(lang, "shopGpsNotSupported"));
        } else {
          setError(t(lang, "shopGpsDenied"));
        }
      }
    })();
  };

  const skipGps = () => {
    setGpsSkipped(true);
    setLatitude(undefined);
    setLongitude(undefined);
    setError(null);
  };

  if (isAuthenticated) return <Navigate to="/" replace />;

  const fieldClass =
    "mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2";

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="rounded-3xl border border-stone-200/80 bg-white p-6 shadow-waka-sm">
        <h1 className="text-2xl font-black text-stone-900">{t(lang, "registerTitle")}</h1>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "loginOwnerHint")}</p>

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
                <div className="flex items-center gap-3 py-1" aria-hidden>
                  <span className="h-px flex-1 bg-stone-200" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">or</span>
                  <span className="h-px flex-1 bg-stone-200" />
                </div>
              </>
            ) : null}

            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerOrgNameLabel")}
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerShopTradeNameLabel")}
              <input
                value={shopDisplayName}
                onChange={(e) => setShopDisplayName(e.target.value)}
                required
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerOwnerFullNameLabel")}
              <input
                value={ownerFullName}
                onChange={(e) => setOwnerFullName(e.target.value)}
                required
                autoComplete="name"
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerPhoneLabel")}
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                inputMode="tel"
                autoComplete="tel"
                placeholder="07XXXXXXXX"
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "registerDistrictLabel")}
              {districtsLoading ? (
                <p className="mt-1 text-xs font-semibold text-stone-500">{t(lang, "registerDistrictsLoading")}</p>
              ) : null}
              {districtsError ? (
                <div className="mt-2 space-y-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  <p>
                    <span className="font-bold">{t(lang, "registerDistrictsLoadFailed")}</span> {districtsError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadDistricts()}
                    className="rounded-lg bg-red-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-800"
                  >
                    {t(lang, "registerDistrictsRetry")}
                  </button>
                </div>
              ) : null}
              {!districtsLoading && !districtsError && districts.length === 0 ? (
                <p className="mt-1 text-xs font-semibold text-amber-800">{t(lang, "registerDistrictsEmptyHint")}</p>
              ) : null}
              <select
                value={districtId}
                onChange={(e) => setDistrictId(e.target.value)}
                required={districts.length > 0}
                disabled={districtsLoading || districts.length === 0}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 font-semibold outline-none ring-waka-200 focus:ring disabled:cursor-not-allowed disabled:bg-stone-100"
              >
                <option value="">{districtsLoading ? "…" : "—"}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerCurrencyLabel")}
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                required
                maxLength={3}
                className="mt-1 w-full rounded-xl border px-3 py-2 font-mono outline-none ring-waka-200 focus:ring"
              />
            </label>

            <div>
              <p className="block text-sm font-bold text-stone-800">{t(lang, "registerBusinessTypeLabel")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
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

            <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-4">
              <p className="text-sm font-bold text-orange-950">{t(lang, "registerGpsTitle")}</p>
              <p className="mt-1 text-xs font-medium text-stone-700">
                {gpsSkipped
                  ? t(lang, "registerGpsSkipLater")
                  : latitude != null && longitude != null
                    ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                    : t(lang, "registerGpsPrompt")}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={captureGps} className="min-h-[44px] flex-1 rounded-xl bg-waka-600 px-3 py-2 text-sm font-black text-white">
                  {t(lang, "registerGpsCapture")}
                </button>
                <button type="button" onClick={skipGps} className="min-h-[44px] flex-1 rounded-xl border-2 border-stone-300 bg-white px-3 py-2 text-sm font-black text-stone-800">
                  {t(lang, "registerGpsSkipLater")}
                </button>
              </div>
            </div>

            <label className="block text-sm font-medium">
              {t(lang, "registerReferralLabel")}
              <input
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder={t(lang, "registerReferralPh")}
                className="mt-1 w-full rounded-xl border px-3 py-2 font-mono uppercase outline-none ring-waka-200 focus:ring"
              />
              <span className="mt-1 block text-xs font-medium text-stone-500">{t(lang, "registerReferralHint")}</span>
            </label>

            <label className="block text-sm font-medium">
              {t(lang, "email")}
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={fieldClass}
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
                className={fieldClass}
              />
            </label>
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
          <Link to="/support" className="font-bold text-waka-800 underline underline-offset-2">
            {t(lang, "supportLoginFooter")}
          </Link>
          <span className="mx-2 text-slate-400">·</span>
          <Link to="/login" className="font-medium text-waka-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
