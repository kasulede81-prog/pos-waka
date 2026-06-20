import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { BusinessType, Language, ShopSellingStyle, UserRole } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import {
  ONBOARDING_BUSINESS_CARDS,
  ONBOARDING_SELLING_STYLES,
  ONBOARDING_STAFF_ROLES,
  type OnboardingStaffRole,
} from "../config/onboardingFlow";
import {
  HOSPITALITY_ONBOARDING_GROUP_ID,
  businessTypeForHospitalityStyle,
  hospitalityStyleIdForBusinessType,
  isHospitalityOnboardingGroupCard,
  type HospitalityOnboardingStyleId,
} from "../config/hospitalityOnboarding";
import { starterPackForBusinessType, type StarterLine } from "../data/starterPacks";
import { AiBusinessSetupCard } from "../components/onboarding/AiBusinessSetupCard";
import type { AiStarterProductRow } from "../lib/ai/aiBusinessSchemas";
import { useSilentAiBusinessSetupPrefetch } from "../hooks/useSilentAiBusinessSetupPrefetch";
import { usePosStore } from "../store/usePosStore";
import { persistOnboardingChoices } from "../lib/shopOnboardingPersist";
import { captureAppException } from "../lib/crashReporting";
import { getDevicePosition, DeviceLocationRequestError } from "../lib/deviceLocation";
import { inferProductGuess } from "../lib/pharmacyUx";
import { PinInput } from "../components/ui/PinInput";
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";
import { normalizeUgPhoneE164, loadRegistrationProfileFromAuth, applyRegistrationProfileToLocalStore } from "../lib/businessProfile";
import { useSubscription } from "../context/SubscriptionContext";
import { maxStaffAccountsForTier, resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { supabase } from "../lib/supabase";
import { useBusinessTypeVisibility } from "../hooks/useBusinessTypeVisibility";
import {
  filterHospitalityOnboardingStyles,
  filterOnboardingBusinessCards,
} from "../config/businessTypeVisibility";

type Props = { lang: Language; setLang: (lg: Language) => void; onSignOut: () => Promise<void> };

type Step = "welcome" | "business" | "hospitality_style" | "selling" | "location" | "staff" | "products";

const fieldClass =
  "mt-1.5 w-full min-h-[48px] rounded-xl border border-stone-200 px-4 py-3 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2";

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex justify-center gap-1.5 py-2" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 rounded-full transition-all ${i <= step ? "w-6 bg-waka-600" : "w-1.5 bg-stone-200"}`} />
      ))}
    </div>
  );
}

export function ShopOnboardingPage({ lang, setLang, onSignOut }: Props) {
  const navigate = useNavigate();
  const preferences = usePosStore((s) => s.preferences);
  const quickAddProduct = usePosStore((s) => s.quickAddProduct);
  const addStaffAccount = usePosStore((s) => s.addStaffAccount);
  const { snapshot, authMode } = useSubscription();
  const {
    settings: bizTypeSettings,
    isSuperAdmin: bizTypeSuperAdmin,
    loading: bizTypeSettingsLoading,
  } = useBusinessTypeVisibility({ forRegistration: true });
  const { prefetch: prefetchAiSetup } = useSilentAiBusinessSetupPrefetch({
    enabled: authMode !== "local",
  });

  const triggerAiSetupPrefetch = (bt: BusinessType) => {
    prefetchAiSetup({ shopName, businessType: bt });
  };

  const visibleBusinessCards = useMemo(
    () => filterOnboardingBusinessCards(ONBOARDING_BUSINESS_CARDS, bizTypeSettings, bizTypeSuperAdmin),
    [bizTypeSettings, bizTypeSuperAdmin],
  );
  const visibleHospitalityStyles = useMemo(
    () => filterHospitalityOnboardingStyles(bizTypeSettings, bizTypeSuperAdmin),
    [bizTypeSettings, bizTypeSuperAdmin],
  );

  const shopName = preferences.shopDisplayName?.trim() || "My Shop";
  const planTier =
    authMode === "local" ? ("waka_plus" as const) : resolveEffectivePlanTier(snapshot);
  const showStaffStep = maxStaffAccountsForTier(planTier) > 0;

  const [booting, setBooting] = useState(true);
  const [ownerName, setOwnerName] = useState("");
  const [registrationDistrictId, setRegistrationDistrictId] = useState("");
  const [skippedWelcome, setSkippedWelcome] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [businessType, setBusinessType] = useState<BusinessType>("kiosk_duka");
  const [selectedBusinessCardId, setSelectedBusinessCardId] = useState<string>("retail");
  const [pickedHospitalityGroup, setPickedHospitalityGroup] = useState(false);
  const [hospitalityStyleId, setHospitalityStyleId] = useState<HospitalityOnboardingStyleId>(() => {
    const fromPrefs = preferences.businessType;
    return hospitalityStyleIdForBusinessType(fromPrefs) ?? "restaurant";
  });
  const [sellingStyle, setSellingStyle] = useState<ShopSellingStyle>("piece");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [gpsSkipped, setGpsSkipped] = useState(true);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtId, setDistrictId] = useState("");
  const [phoneFallback, setPhoneFallback] = useState("");

  useEffect(() => {
    if (bizTypeSettingsLoading || visibleBusinessCards.length === 0) return;
    const allowed = new Set<BusinessType>();
    for (const card of visibleBusinessCards) {
      if (card.businessType) allowed.add(card.businessType);
      if (card.hospitalityGroup) {
        for (const style of visibleHospitalityStyles) allowed.add(style.businessType);
      }
    }
    if (allowed.has(businessType)) return;
    const first = visibleBusinessCards[0];
    if (first?.hospitalityGroup) {
      setPickedHospitalityGroup(true);
      setSelectedBusinessCardId(first.id);
      const style = visibleHospitalityStyles[0];
      if (style) {
        setHospitalityStyleId(style.id);
        setBusinessType(style.businessType);
      }
    } else if (first?.businessType) {
      setPickedHospitalityGroup(false);
      setSelectedBusinessCardId(first.id);
      setBusinessType(first.businessType);
    }
  }, [
    bizTypeSettingsLoading,
    visibleBusinessCards,
    visibleHospitalityStyles,
    businessType,
    hospitalityStyleId,
  ]);

  useEffect(() => {
    void fetchDistricts().then(({ districts: d }) => setDistricts(d));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const profile = await loadRegistrationProfileFromAuth();
        if (profile) {
          applyRegistrationProfileToLocalStore(profile);
          if (profile.ownerFullName) setOwnerName(profile.ownerFullName);
          if (profile.districtId) {
            setDistrictId(profile.districtId);
            setRegistrationDistrictId(profile.districtId);
          }
          if (profile.phoneE164) setPhoneFallback(profile.phoneE164);
          if (profile.shopDisplayName) {
            setStep("business");
            setSkippedWelcome(true);
          }
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    const fromPrefs = preferences.shopPhoneE164?.trim() ?? "";
    if (fromPrefs && !phoneFallback) setPhoneFallback(fromPrefs);
  }, [preferences.shopPhoneE164, phoneFallback]);

  useEffect(() => {
    const bt = preferences.businessType;
    const style = hospitalityStyleIdForBusinessType(bt);
    if (style) {
      setPickedHospitalityGroup(true);
      setSelectedBusinessCardId(HOSPITALITY_ONBOARDING_GROUP_ID);
      setHospitalityStyleId(style);
      setBusinessType(bt);
    }
  }, [preferences.businessType]);

  const [staffOpen, setStaffOpen] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<OnboardingStaffRole>("cashier");
  const [staffPin, setStaffPin] = useState("");

  const stepOrder = useMemo(() => {
    const order: Step[] = ["welcome", "business"];
    if (pickedHospitalityGroup) order.push("hospitality_style");
    order.push("selling", "location");
    if (showStaffStep) order.push("staff");
    order.push("products");
    return order;
  }, [showStaffStep, pickedHospitalityGroup]);

  const stepIndex = useMemo(() => stepOrder.indexOf(step), [stepOrder, step]);
  const progressTotal = Math.max(stepOrder.length - 1, 1);
  const districtLabel = useMemo(
    () => districts.find((d) => d.id === districtId)?.name ?? "",
    [districts, districtId],
  );
  const contactFromSignup = Boolean(
    registrationDistrictId && (normalizeUgPhoneE164(phoneFallback) || normalizeUgPhoneE164(preferences.shopPhoneE164 ?? "")),
  );

  const resolveOnboardingPhone = async (): Promise<string | null> => {
    const candidates = [
      phoneFallback,
      preferences.shopPhoneE164 ?? "",
    ];
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
      candidates.push(String(meta?.phone_e164 ?? meta?.phone ?? ""));
    }
    for (const raw of candidates) {
      const ph = normalizeUgPhoneE164(raw);
      if (ph) return ph;
    }
    return null;
  };

  const advanceAfterLocation = async () => {
    if (showStaffStep) {
      setStep("staff");
      return;
    }
    const ok = await finishCore({ gpsSkipped, lat, lng });
    if (ok) setStep("products");
  };

  const finishCore = async (opts: { gpsSkipped: boolean; lat?: number; lng?: number }) => {
    setBusy(true);
    setErr(null);
    try {
      const ph = await resolveOnboardingPhone();
      const requiresCloudPhone = authMode !== "local";
      if (requiresCloudPhone && !ph) {
        setErr(t(lang, "registerPhoneInvalid"));
        setBusy(false);
        return false;
      }
      if (!districtId) {
        setErr(t(lang, "businessProfileDistrictRequired"));
        setBusy(false);
        return false;
      }
      await persistOnboardingChoices({
        shopName,
        businessType,
        sellingStyle,
        phone: ph ?? "",
        districtId,
        latitude: opts.lat,
        longitude: opts.lng,
        gpsSkipped: opts.gpsSkipped,
      });
    } catch (e) {
      captureAppException(e, { scope: "onboarding_persist" });
      setErr((e as Error).message);
      setBusy(false);
      return false;
    }
    setBusy(false);
    return true;
  };

  const captureLocation = () => {
    setErr(null);
    void (async () => {
      try {
        const pos = await getDevicePosition();
        setLat(pos.latitude);
        setLng(pos.longitude);
        setGpsSkipped(false);
      } catch (e) {
        if (e instanceof DeviceLocationRequestError && e.reason === "unsupported") {
          setErr(t(lang, "shopGpsNotSupported"));
        } else {
          setErr(t(lang, "shopGpsDenied"));
        }
      }
    })();
  };

  const starterProducts = useMemo(() => starterPackForBusinessType(businessType), [businessType]);

  const addAiStarterProducts = (rows: AiStarterProductRow[]) => {
    for (const row of rows) {
      quickAddProduct({
        name: row.name,
        inferName: row.name,
        priceUgx: Math.max(0, Math.floor(row.suggestedPriceUgx)),
        stockQty: Math.max(0, row.suggestedStockQty),
        category: row.category || "General",
        sellingMode: row.sellingMode,
        baseUnit: row.unit,
      });
    }
  };

  const addStarterProduct = (line: StarterLine) => {
    const guess = inferProductGuess(line.inferName, businessType, businessType === "pharmacy");
    const mixed = sellingStyle === "mixed" && (line.sellingMode === "weighted" || line.sellingMode === "unit");
    quickAddProduct({
      name: t(lang, line.nameKey as "starterItem_sugar"),
      inferName: line.inferName,
      priceUgx: line.defaultPriceUgx,
      stockQty: line.defaultStock,
      category: line.category ?? "General",
      sellingMode: line.sellingMode,
      baseUnit: line.baseUnit,
      buyingUnit: mixed ? guess.buyingUnit ?? "carton" : undefined,
      conversionRate: mixed ? guess.conversionRate : undefined,
      medicineStrength: line.medicineStrength ?? null,
      medicineForm: line.medicineForm ?? null,
    });
  };

  const cardBtn =
    "min-h-[72px] w-full rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.99]";
  const primaryBtn =
    "min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50";

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="mx-auto max-w-md rounded-3xl border border-stone-200/80 bg-white p-5 shadow-waka-sm sm:p-6">
        {booting ? (
          <p className="py-16 text-center text-sm font-semibold text-stone-500">…</p>
        ) : null}
        {!booting && step !== "welcome" ? <ProgressDots step={stepIndex} total={progressTotal} /> : null}

        {!booting && step === "welcome" ? (
          <div className="space-y-5 py-2 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-waka-700">{t(lang, "onboardWelcomeKicker")}</p>
            <h1 className="text-2xl font-black text-stone-900">{t(lang, "onboardWelcomeTitle")}</h1>
            <p className="text-base font-medium text-stone-600">{t(lang, "onboardWelcomeSub")}</p>
            <p className="text-sm font-bold text-waka-800">{t(lang, "onboardWelcomeSellFirst")}</p>
            {ownerName ? (
              <p className="text-sm font-bold text-stone-700">
                {t(lang, "registerOwnerFullNameLabel")}: {ownerName}
              </p>
            ) : null}
            <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "registerShopNameLabel")}</p>
            <p className="rounded-2xl bg-orange-50 px-4 py-3 text-sm font-bold text-waka-900">{shopName}</p>
            <button type="button" className={primaryBtn} onClick={() => setStep("business")}>
              {t(lang, "onboardLetsGo")}
            </button>
            <button
              type="button"
              className="mt-2 text-sm font-bold text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
              onClick={() => void onSignOut().then(() => navigate("/login"))}
            >
              {t(lang, "haveAccount")} — {t(lang, "staffLoginBack")} to sign in
            </button>
          </div>
        ) : null}

        {!booting && step === "business" ? (
          <div className="space-y-4">
            {!skippedWelcome ? (
              <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("welcome")}>
                <ChevronLeft className="mr-1 inline h-4 w-4" />
                {t(lang, "onboardBack")}
              </button>
            ) : null}
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardBizTitle")}</h2>
            {bizTypeSettingsLoading ? (
              <p className="text-sm font-semibold text-stone-500">{t(lang, "onboardBizLoading")}</p>
            ) : visibleBusinessCards.length === 0 ? (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
                {t(lang, "onboardBizNoneEnabled")}
              </p>
            ) : null}
            <div className="grid gap-2">
              {!bizTypeSettingsLoading &&
                visibleBusinessCards.map((card) => {
                const selected =
                  card.hospitalityGroup
                    ? selectedBusinessCardId === card.id
                    : selectedBusinessCardId === card.id ||
                      (card.businessType != null && businessType === card.businessType && !pickedHospitalityGroup);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      setSelectedBusinessCardId(card.id);
                      if (card.hospitalityGroup) {
                        setPickedHospitalityGroup(true);
                        const bt = businessTypeForHospitalityStyle(hospitalityStyleId);
                        setBusinessType(bt);
                        triggerAiSetupPrefetch(bt);
                      } else if (card.businessType) {
                        setPickedHospitalityGroup(false);
                        setBusinessType(card.businessType);
                        triggerAiSetupPrefetch(card.businessType);
                      }
                    }}
                    className={`${cardBtn} ${selected ? "border-waka-500 bg-waka-50" : "border-stone-200 bg-white"}`}
                  >
                    <span className="text-2xl">{card.emoji}</span>
                    <span className="mt-1 block text-base font-black text-stone-900">{t(lang, card.labelKey)}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={bizTypeSettingsLoading || visibleBusinessCards.length === 0}
              className={primaryBtn}
              onClick={() => {
                if (pickedHospitalityGroup || isHospitalityOnboardingGroupCard(selectedBusinessCardId)) {
                  const bt = businessTypeForHospitalityStyle(hospitalityStyleId);
                  setBusinessType(bt);
                  triggerAiSetupPrefetch(bt);
                  setStep("hospitality_style");
                } else {
                  triggerAiSetupPrefetch(businessType);
                  setStep("selling");
                }
              }}
            >
              {t(lang, "onboardContinue")}
            </button>
          </div>
        ) : null}

        {!booting && step === "hospitality_style" ? (
          <div className="space-y-4">
            <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("business")}>
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              {t(lang, "onboardBack")}
            </button>
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardHospitalityStyleTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">{t(lang, "onboardHospitalityStyleSub")}</p>
            <div className="grid gap-2">
              {visibleHospitalityStyles.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => {
                    setHospitalityStyleId(style.id);
                    setBusinessType(style.businessType);
                    triggerAiSetupPrefetch(style.businessType);
                  }}
                  className={`${cardBtn} ${
                    hospitalityStyleId === style.id ? "border-waka-500 bg-waka-50" : "border-stone-200 bg-white"
                  }`}
                >
                  <span className="text-2xl">{style.emoji}</span>
                  <span className="mt-1 block text-base font-black text-stone-900">{t(lang, style.labelKey)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => {
                const bt = businessTypeForHospitalityStyle(hospitalityStyleId);
                setBusinessType(bt);
                triggerAiSetupPrefetch(bt);
                setStep("selling");
              }}
            >
              {t(lang, "onboardContinue")}
            </button>
          </div>
        ) : null}

        {!booting && step === "selling" ? (
          <div className="space-y-4">
            <button
              type="button"
              className="text-sm font-bold text-stone-500"
              onClick={() => setStep(pickedHospitalityGroup ? "hospitality_style" : "business")}
            >
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              {t(lang, "onboardBack")}
            </button>
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardSellTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">{t(lang, "onboardSellSub")}</p>
            <div className="grid gap-2">
              {ONBOARDING_SELLING_STYLES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSellingStyle(opt.id)}
                  className={`${cardBtn} ${
                    sellingStyle === opt.id ? "border-waka-500 bg-waka-50" : "border-stone-200 bg-white"
                  }`}
                >
                  <span className="text-xl">{opt.emoji}</span>
                  <span className="mt-0.5 block text-base font-black">{t(lang, opt.labelKey)}</span>
                  <span className="block text-xs font-medium text-stone-600">{t(lang, opt.hintKey)}</span>
                </button>
              ))}
            </div>
            {sellingStyle === "mixed" ? (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">{t(lang, "onboardSellMixedNote")}</p>
            ) : null}
            <button type="button" className={primaryBtn} onClick={() => setStep("location")}>
              {t(lang, "onboardContinue")}
            </button>
          </div>
        ) : null}

        {!booting && step === "location" ? (
          <div className="space-y-4">
            <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("selling")}>
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              {t(lang, "onboardBack")}
            </button>
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardLocTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">
              {contactFromSignup ? t(lang, "onboardLocGpsOnlySub") : t(lang, "onboardLocSub")}
            </p>
            {contactFromSignup && districtLabel ? (
              <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-800">
                {t(lang, "registerDistrictLabel")}: {districtLabel}
              </p>
            ) : (
              <>
                <label className="block text-sm font-bold text-stone-800">{t(lang, "registerDistrictLabel")}</label>
                <select
                  value={districtId}
                  onChange={(e) => setDistrictId(e.target.value)}
                  className={fieldClass}
                  required
                >
                  <option value="">—</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
            {!gpsSkipped && lat != null ? (
              <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs font-mono text-stone-700">
                {lat.toFixed(5)}, {lng?.toFixed(5)}
              </p>
            ) : null}
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void captureLocation()}>
              {t(lang, "onboardLocUse")}
            </button>
            <button
              type="button"
              className="min-h-[48px] w-full rounded-2xl border-2 border-stone-200 bg-white text-base font-black text-stone-800"
              disabled={busy}
              onClick={() => {
                setGpsSkipped(true);
                setLat(undefined);
                setLng(undefined);
                void advanceAfterLocation();
              }}
            >
              {t(lang, "onboardLocSkip")}
            </button>
            {!gpsSkipped && lat != null ? (
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => void advanceAfterLocation()}>
                {t(lang, "onboardContinue")}
              </button>
            ) : null}
          </div>
        ) : null}

        {!booting && step === "staff" ? (
          <div className="space-y-4">
            <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("location")}>
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              {t(lang, "onboardBack")}
            </button>
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardStaffTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">{t(lang, "onboardStaffSub")}</p>
            <button
              type="button"
              className={primaryBtn}
              disabled={busy}
              onClick={async () => {
                const ok = await finishCore({ gpsSkipped, lat, lng });
                if (ok) setStep("products");
              }}
            >
              {busy ? "…" : t(lang, "onboardStaffSkip")}
            </button>
            <details
              className="rounded-2xl border border-stone-200 bg-stone-50/80"
              open={staffOpen}
              onToggle={(e) => setStaffOpen(e.currentTarget.open)}
            >
              <summary className="cursor-pointer px-4 py-3 text-sm font-black text-stone-800">{t(lang, "onboardStaffAddOne")}</summary>
              <div className="space-y-3 border-t border-stone-100 px-4 pb-4 pt-3">
                <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder={t(lang, "staffNamePh")} className={fieldClass} />
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as OnboardingStaffRole)}
                  className={fieldClass}
                >
                  {ONBOARDING_STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(lang, `role_${r}`)}
                    </option>
                  ))}
                </select>
                <PinInput
                  value={staffPin}
                  onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t(lang, "staffPinPh")}
                  maxLength={6}
                  autoComplete="off"
                  className={fieldClass}
                />
                <button
                  type="button"
                  className="min-h-[44px] w-full rounded-xl border-2 border-waka-300 bg-white text-sm font-black text-waka-900"
                  onClick={async () => {
                    if (!staffName.trim() || staffPin.length < 4) {
                      setErr(t(lang, "registerFieldRequired"));
                      return;
                    }
                    addStaffAccount({
                      name: staffName.trim(),
                      username: `${staffRole}01`,
                      role: staffRole as UserRole,
                      pin: staffPin,
                    });
                    const ok = await finishCore({ gpsSkipped, lat, lng });
                    if (ok) setStep("products");
                  }}
                >
                  {t(lang, "onboardStaffSave")}
                </button>
              </div>
            </details>
            {err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
          </div>
        ) : null}

        {!booting && step === "products" ? (
          <div className="space-y-4">
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardProductsTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">{t(lang, "onboardProductsSub")}</p>
            <p className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 text-sm font-bold text-waka-950">
              {t(lang, "onboardProductsPriority")}
            </p>
            <p className="text-xs font-semibold text-stone-500">{t(lang, "onboardFinishLaterHint")}</p>
            <AiBusinessSetupCard
              lang={lang}
              shopName={shopName}
              businessType={businessType}
              enabled={authMode !== "local"}
              onUseStarter={addAiStarterProducts}
              onSkipClassic={() => {}}
            />
            <div className="grid grid-cols-2 gap-2">
              {starterProducts.map((line) => (
                <button
                  key={line.nameKey}
                  type="button"
                  onClick={() => addStarterProduct(line)}
                  className="min-h-[56px] rounded-2xl border-2 border-stone-200 bg-white px-3 py-2 text-sm font-black text-stone-900 active:bg-waka-50"
                >
                  + {t(lang, line.nameKey as "starterItem_sugar")}
                </button>
              ))}
            </div>
            <button type="button" className={primaryBtn} onClick={() => navigate("/pos", { replace: true })}>
              {t(lang, "onboardStartSelling")}
            </button>
            <button type="button" className="text-sm font-bold text-stone-500 underline" onClick={() => navigate("/", { replace: true })}>
              {t(lang, "onboardProductsLater")}
            </button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
