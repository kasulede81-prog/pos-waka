import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type { BusinessType, Language } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import { hasSupabaseConfig } from "../lib/supabase";
import type { SignUpProfileMeta, SignUpResult } from "../hooks/useAuth";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("kiosk_duka");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const d = await fetchDistricts();
      if (!cancelled) setDistricts(d);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setError((err as Error).message || t(lang, "signupWorkspaceError"));
    } finally {
      setGoogleBusy(false);
    }
  };

  const captureGps = () => {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError(t(lang, "shopGpsNotSupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setGpsSkipped(false);
      },
      () => {
        setError(t(lang, "shopGpsDenied"));
      },
      { enableHighAccuracy: true, timeout: 25_000, maximumAge: 120_000 },
    );
  };

  const skipGps = () => {
    setGpsSkipped(true);
    setLatitude(undefined);
    setLongitude(undefined);
    setError(null);
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
            <p className="text-xs font-semibold text-stone-500">{t(lang, "registerGoogleNote")}</p>

            <label className="block text-sm font-medium">
              {t(lang, "registerOrgNameLabel")}
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerShopTradeNameLabel")}
              <input
                value={shopDisplayName}
                onChange={(e) => setShopDisplayName(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerOwnerFullNameLabel")}
              <input
                value={ownerFullName}
                onChange={(e) => setOwnerFullName(e.target.value)}
                required
                autoComplete="name"
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
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
                className="mt-1 w-full rounded-xl border px-3 py-2 outline-none ring-waka-200 focus:ring"
              />
            </label>
            <label className="block text-sm font-medium">
              {t(lang, "registerDistrictLabel")}
              <select
                value={districtId}
                onChange={(e) => setDistrictId(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 font-semibold outline-none ring-waka-200 focus:ring"
              >
                <option value="">—</option>
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
              <p className="block text-sm font-medium">{t(lang, "registerBusinessTypeLabel")}</p>
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
