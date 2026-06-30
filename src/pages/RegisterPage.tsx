import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Language } from "../types";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { BusinessBuilderShell } from "../components/businessBuilder/BusinessBuilderShell";
import { BuilderField, BuilderPrimaryButton } from "../components/businessBuilder/BuilderField";
import { useBusinessBuilder } from "../context/BusinessBuilderContext";
import { registrationUnlocks } from "../lib/businessBuilder/businessSceneState";
import { t, tTemplate } from "../lib/i18n";
import { formatAuthError } from "../lib/authConfig";
import { isGoogleAuthUiAvailable } from "../lib/authFeatureFlags";
import { hasSupabaseConfig } from "../lib/supabase";
import type { SignUpResult } from "../hooks/useAuth";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";
import { storePendingReferralCode } from "../lib/pendingReferral";
import { normalizeReferralCode, validateReferralCode } from "../lib/referralAgents";
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";
import { useMountedRef } from "../hooks/useMountedRef";
import { hapticTap } from "../lib/nativeFeedback";
import { usePosStore } from "../store/usePosStore";

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

function passwordStrength(pw: string): "weak" | "fair" | "strong" {
  if (pw.length < 8) return "weak";
  const score = [/[A-Z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  if (pw.length >= 12 && score >= 2) return "strong";
  if (score >= 1) return "fair";
  return "weak";
}

export function RegisterPage({ lang, setLang, isAuthenticated, signUpQuick, onGoogleSignIn }: Props) {
  const navigate = useNavigate();
  const mountedRef = useMountedRef();
  const submitLockRef = useRef(false);
  const completedRef = useRef<Record<string, boolean>>({});
  const [searchParams] = useSearchParams();
  const { patchScene } = useBusinessBuilder();
  const hapticsOn = usePosStore((s) => s.preferences.hapticsOn ?? true);

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
  const [referralOk, setReferralOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const showGoogle = hasSupabaseConfig && isGoogleAuthUiAvailable();

  const emailNorm = email.trim().toLowerCase();
  const emailValid = emailNorm.includes("@") && emailNorm.includes(".");
  const phoneValid = Boolean(normalizeUgPhoneE164(phone));
  const districtName = districts.find((d) => d.id === districtId)?.name ?? "";
  const pwStrength = passwordStrength(password);
  const locked = password.length >= 8;

  const fieldComplete = useMemo(
    () => ({
      shopName: shopName.trim().length >= 2,
      ownerName: ownerName.trim().length >= 2,
      email: emailValid,
      phone: phoneValid,
      district: Boolean(districtId),
      password: locked,
      referral: !referralCode.trim() || referralOk,
    }),
    [shopName, ownerName, emailValid, phoneValid, districtId, locked, referralCode, referralOk],
  );

  const unlocks = useMemo(
    () =>
      registrationUnlocks({
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        districtName,
        hasBuilding: fieldComplete.shopName,
        hasSign: fieldComplete.shopName,
        hasOwner: fieldComplete.ownerName,
        hasPhone: fieldComplete.phone,
        hasMailbox: fieldComplete.email,
        hasMapPin: fieldComplete.district,
        isLocked: fieldComplete.password,
        hasReferral: fieldComplete.referral && Boolean(referralCode.trim()),
        hasShelves: false,
        hasProducts: false,
        productCount: 0,
        hasPrinter: false,
        hasStaff: false,
        hasWakaBadge: false,
        hasCloudSync: false,
        hasAiAssistant: false,
        businessType: null,
        businessCardId: null,
        sellingStyle: null,
        activationMode: "none",
        emailPending: false,
        mailboxOpen: false,
        isOpen: false,
        grandOpeningPlayed: false,
      }),
    [shopName, ownerName, districtName, fieldComplete, referralCode],
  );

  const bumpHaptic = useCallback(
    (key: string, done: boolean) => {
      if (!done || completedRef.current[key]) return;
      completedRef.current[key] = true;
      if (hapticsOn) void hapticTap();
    },
    [hapticsOn],
  );

  useEffect(() => {
    patchScene({
      shopName: shopName.trim(),
      ownerName: ownerName.trim(),
      districtName,
      hasBuilding: shopName.trim().length > 0,
      hasSign: fieldComplete.shopName,
      hasOwner: fieldComplete.ownerName,
      hasMailbox: fieldComplete.email,
      hasPhone: fieldComplete.phone,
      hasMapPin: fieldComplete.district,
      isLocked: fieldComplete.password,
      hasReferral: fieldComplete.referral && Boolean(referralCode.trim()),
    });
    bumpHaptic("shopName", fieldComplete.shopName);
    bumpHaptic("ownerName", fieldComplete.ownerName);
    bumpHaptic("email", fieldComplete.email);
    bumpHaptic("phone", fieldComplete.phone);
    bumpHaptic("district", fieldComplete.district);
    bumpHaptic("password", fieldComplete.password);
  }, [shopName, ownerName, districtName, fieldComplete, referralCode, patchScene, bumpHaptic]);

  const loadDistricts = useCallback(async () => {
    if (!mountedRef.current) return;
    setDistrictsLoading(true);
    setDistrictsError(null);
    try {
      const { districts: d, error: err } = await fetchDistricts();
      if (!mountedRef.current) return;
      setDistricts(d);
      if (err) setDistrictsError(err);
    } catch (e) {
      if (!mountedRef.current) return;
      setDistrictsError((e as Error).message || "Could not load districts.");
    } finally {
      if (mountedRef.current) setDistrictsLoading(false);
    }
  }, [mountedRef]);

  useEffect(() => {
    const ref = searchParams.get("ref")?.trim();
    if (!ref) return;
    const code = ref.toUpperCase();
    setReferralCode(code);
    storePendingReferralCode(code);
  }, [searchParams]);

  useEffect(() => {
    if (!isAuthenticated || busy || submitLockRef.current) return;
    navigate("/onboarding", { replace: true });
  }, [busy, isAuthenticated, navigate]);

  const validateReferralField = useCallback(
    async (raw: string): Promise<boolean> => {
      const trimmed = normalizeReferralCode(raw);
      if (!trimmed) {
        if (mountedRef.current) {
          setReferralHint(null);
          setReferralOk(false);
        }
        return true;
      }
      if (mountedRef.current) setReferralValidating(true);
      try {
        const res = await validateReferralCode(trimmed);
        if (!mountedRef.current) return res.ok;
        if (!res.ok) {
          setReferralHint(t(lang, "registerReferralInvalid"));
          setReferralOk(false);
          return false;
        }
        setReferralOk(true);
        bumpHaptic("referral", true);
        patchScene({ hasReferral: true });
        setReferralHint(
          res.agentName ? tTemplate(lang, "registerReferralValid", { name: res.agentName }) : null,
        );
        if (res.referralCode) setReferralCode(res.referralCode);
        return true;
      } catch {
        if (mountedRef.current) {
          setReferralHint(t(lang, "registerReferralInvalid"));
          setReferralOk(false);
        }
        return false;
      } finally {
        if (mountedRef.current) setReferralValidating(false);
      }
    },
    [lang, mountedRef, bumpHaptic, patchScene],
  );

  useEffect(() => {
    if (hasSupabaseConfig) void loadDistricts();
  }, [loadDistricts]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || busy) return;
    setError(null);
    if (!shopName.trim() || !ownerName.trim() || !emailNorm) {
      setError(t(lang, "registerFieldRequired"));
      return;
    }
    if (!emailValid) {
      setError(t(lang, "registerEmailInvalid"));
      return;
    }
    if (password.length < 8) {
      setError(t(lang, "passwordTooShort"));
      return;
    }
    if (!phoneValid) {
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
        if (mountedRef.current) setError(t(lang, "registerReferralInvalid"));
        return;
      }
    }
    submitLockRef.current = true;
    if (mountedRef.current) setBusy(true);
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
      if (!mountedRef.current) return;
      if (referralCode.trim()) storePendingReferralCode(referralCode.trim());
      if (result.needsEmailVerification) {
        patchScene({ emailPending: true, hasMailbox: true });
        queueMicrotask(() => {
          navigate("/verify-email", { replace: true, state: { email: emailNorm } });
        });
        return;
      }
      queueMicrotask(() => {
        navigate("/onboarding", { replace: true });
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = formatAuthError(err);
      const lower = msg.toLowerCase();
      if (
        lower.includes("database error saving new user") ||
        lower.includes("could not finish creating your shop")
      ) {
        setError(t(lang, "signupWorkspaceError"));
      } else {
        setError(msg);
      }
    } finally {
      submitLockRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const googleSubmit = async () => {
    if (googleBusy || submitLockRef.current) return;
    if (mountedRef.current) {
      setGoogleBusy(true);
      setError(null);
    }
    try {
      const code = referralCode.trim() || searchParams.get("ref")?.trim();
      await onGoogleSignIn(code ? { referralCode: code } : undefined);
    } catch (err) {
      if (mountedRef.current) setError(formatAuthError(err));
    } finally {
      if (mountedRef.current) setGoogleBusy(false);
    }
  };

  if (isAuthenticated && !busy) {
    return (
      <BusinessBuilderShell lang={lang} setLang={setLang} funnelStep="account" unlocks={unlocks}>
        <p className="py-12 text-center text-sm font-semibold text-stone-600">…</p>
      </BusinessBuilderShell>
    );
  }

  const pwLabel =
    pwStrength === "strong"
      ? t(lang, "builderPasswordStrong")
      : pwStrength === "fair"
        ? t(lang, "builderPasswordFair")
        : t(lang, "builderPasswordWeak");

  return (
    <BusinessBuilderShell lang={lang} setLang={setLang} funnelStep="account" unlocks={unlocks}>
      <div className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_16px_48px_-24px_rgba(0,0,0,0.2)] backdrop-blur-sm sm:rounded-[32px] sm:p-6">
        <h1 className="text-2xl font-black tracking-tight text-stone-900 sm:text-3xl">
          {t(lang, "registerQuickTitle")}
        </h1>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "registerQuickSub")}</p>

        {!hasSupabaseConfig ? (
          <div className="mt-6 space-y-3">
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {t(lang, "supabaseMissing")}
            </p>
            <p className="text-sm text-stone-600">{t(lang, "supabaseRegisterHint")}</p>
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

            <BuilderField
              label={t(lang, "registerShopNameLabel")}
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              required
              autoComplete="organization"
              placeholder={t(lang, "registerShopNamePh")}
              complete={fieldComplete.shopName}
            />

            <BuilderField
              label={t(lang, "registerOwnerFullNameLabel")}
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Kasule Denis"
              complete={fieldComplete.ownerName}
            />

            <BuilderField
              label={t(lang, "registerEmailLabel")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder={t(lang, "registerEmailPh")}
              complete={fieldComplete.email}
              hint={t(lang, "registerEmailRequiredHint")}
            />

            <BuilderField
              label={t(lang, "registerPhoneLabel")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="07XXXXXXXX"
              complete={fieldComplete.phone}
            />

            <BuilderField
              as="select"
              label={t(lang, "registerDistrictLabel")}
              value={districtId}
              onChange={(e) => setDistrictId(e.target.value)}
              required
              complete={fieldComplete.district}
            >
              <option value="">—</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </BuilderField>
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

            <div>
              <BuilderField
                label={t(lang, "password")}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                complete={fieldComplete.password}
              />
              {password ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pwStrength === "strong"
                          ? "w-full bg-emerald-500"
                          : pwStrength === "fair"
                            ? "w-2/3 bg-amber-500"
                            : "w-1/3 bg-red-400"
                      }`}
                    />
                  </div>
                  <span className="text-xs font-bold text-stone-500">{pwLabel}</span>
                </div>
              ) : null}
            </div>

            <BuilderField
              label={t(lang, "registerReferralLabel")}
              value={referralCode}
              onChange={(e) => {
                setReferralCode(e.target.value.toUpperCase());
                setReferralHint(null);
                setReferralOk(false);
              }}
              onBlur={() => void validateReferralField(referralCode)}
              placeholder={t(lang, "registerReferralPh")}
              autoComplete="off"
              className="font-mono uppercase"
              complete={fieldComplete.referral && Boolean(referralCode.trim())}
              hint={t(lang, "registerReferralHint")}
            />
            {referralValidating ? <p className="text-xs font-semibold text-stone-500">…</p> : null}
            {referralHint ? (
              <p
                className={`text-xs font-semibold ${referralHint === t(lang, "registerReferralInvalid") ? "text-red-600" : "text-emerald-800"}`}
              >
                {referralHint}
              </p>
            ) : null}

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <BuilderPrimaryButton
              type="submit"
              disabled={busy || districtsLoading || districts.length === 0}
            >
              {busy ? "…" : t(lang, "builderRegisterCta")}
            </BuilderPrimaryButton>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-stone-600">
          <Link to="/login" className="font-bold text-waka-700 underline underline-offset-2">
            {t(lang, "backToLogin")}
          </Link>
        </p>
      </div>
    </BusinessBuilderShell>
  );
}
