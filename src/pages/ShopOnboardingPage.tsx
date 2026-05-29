import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { BusinessType, Language, ShopSellingStyle, UserRole } from "../types";
import { AuthLayout } from "../components/AuthLayout";
import { t } from "../lib/i18n";
import {
  FIRST_PRODUCT_TEMPLATES,
  ONBOARDING_BUSINESS_CARDS,
  ONBOARDING_SELLING_STYLES,
  ONBOARDING_STAFF_ROLES,
  type OnboardingStaffRole,
} from "../config/onboardingFlow";
import { usePosStore } from "../store/usePosStore";
import { persistOnboardingChoices } from "../lib/shopOnboardingPersist";
import { getDevicePosition, DeviceLocationRequestError } from "../lib/deviceLocation";
import { inferFromProductName } from "../lib/smartProductGuess";
import { PinInput } from "../components/ui/PinInput";
import { fetchDistricts, type DistrictRow } from "../lib/shopDistricts";
import { normalizeUgPhoneE164 } from "../lib/businessProfile";

type Props = { lang: Language; setLang: (lg: Language) => void; onSignOut: () => Promise<void> };

type Step = "welcome" | "business" | "selling" | "location" | "staff" | "products";

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

  const shopName = preferences.shopDisplayName?.trim() || "My Shop";

  const [step, setStep] = useState<Step>("welcome");
  const [businessType, setBusinessType] = useState<BusinessType>("kiosk_duka");
  const [sellingStyle, setSellingStyle] = useState<ShopSellingStyle>("piece");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [gpsSkipped, setGpsSkipped] = useState(true);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtId, setDistrictId] = useState("");

  useEffect(() => {
    void fetchDistricts().then(({ districts: d }) => setDistricts(d));
  }, []);

  const [staffOpen, setStaffOpen] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<OnboardingStaffRole>("cashier");
  const [staffPin, setStaffPin] = useState("");

  const stepIndex = useMemo(() => {
    const order: Step[] = ["welcome", "business", "selling", "location", "staff", "products"];
    return order.indexOf(step);
  }, [step]);

  const finishCore = async (opts: { gpsSkipped: boolean; lat?: number; lng?: number }) => {
    setBusy(true);
    setErr(null);
    try {
      const ph = normalizeUgPhoneE164(preferences.shopPhoneE164 ?? "");
      if (!ph) {
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
        phone: ph,
        districtId,
        latitude: opts.lat,
        longitude: opts.lng,
        gpsSkipped: opts.gpsSkipped,
      });
    } catch (e) {
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

  const addTemplateProduct = (tpl: (typeof FIRST_PRODUCT_TEMPLATES)[number]) => {
    const guess = inferFromProductName(tpl.inferName);
    const mixed = sellingStyle === "mixed" && tpl.preferPackWhenMixed;
    quickAddProduct({
      name: t(lang, tpl.nameKey as "starterItem_sugar"),
      inferName: tpl.inferName,
      priceUgx: tpl.defaultPriceUgx,
      stockQty: tpl.defaultStock,
      category: "General",
      sellingMode: tpl.sellingMode,
      baseUnit: tpl.baseUnit,
      buyingUnit: mixed ? guess.buyingUnit ?? "carton" : undefined,
      conversionRate: mixed ? guess.conversionRate : undefined,
    });
  };

  const cardBtn =
    "min-h-[72px] w-full rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.99]";
  const primaryBtn =
    "min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-waka-sm disabled:opacity-50";

  return (
    <AuthLayout lang={lang} setLang={setLang}>
      <div className="mx-auto max-w-md rounded-3xl border border-stone-200/80 bg-white p-5 shadow-waka-sm sm:p-6">
        {step !== "welcome" ? <ProgressDots step={stepIndex} total={5} /> : null}

        {step === "welcome" ? (
          <div className="space-y-5 py-2 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-waka-700">{t(lang, "onboardWelcomeKicker")}</p>
            <h1 className="text-2xl font-black text-stone-900">{t(lang, "onboardWelcomeTitle")}</h1>
            <p className="text-base font-medium text-stone-600">{t(lang, "onboardWelcomeSub")}</p>
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

        {step === "business" ? (
          <div className="space-y-4">
            <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("welcome")}>
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              {t(lang, "onboardBack")}
            </button>
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardBizTitle")}</h2>
            <div className="grid gap-2">
              {ONBOARDING_BUSINESS_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setBusinessType(card.businessType)}
                  className={`${cardBtn} ${
                    businessType === card.businessType ? "border-waka-500 bg-waka-50" : "border-stone-200 bg-white"
                  }`}
                >
                  <span className="text-2xl">{card.emoji}</span>
                  <span className="mt-1 block text-base font-black text-stone-900">{t(lang, card.labelKey)}</span>
                </button>
              ))}
            </div>
            <button type="button" className={primaryBtn} onClick={() => setStep("selling")}>
              {t(lang, "onboardContinue")}
            </button>
          </div>
        ) : null}

        {step === "selling" ? (
          <div className="space-y-4">
            <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("business")}>
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

        {step === "location" ? (
          <div className="space-y-4">
            <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setStep("selling")}>
              <ChevronLeft className="mr-1 inline h-4 w-4" />
              {t(lang, "onboardBack")}
            </button>
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardLocTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">{t(lang, "onboardLocSub")}</p>
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
                setStep("staff");
              }}
            >
              {t(lang, "onboardLocSkip")}
            </button>
            {!gpsSkipped && lat != null ? (
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => setStep("staff")}>
                {t(lang, "onboardContinue")}
              </button>
            ) : null}
          </div>
        ) : null}

        {step === "staff" ? (
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

        {step === "products" ? (
          <div className="space-y-4">
            <h2 className="text-xl font-black text-stone-900">{t(lang, "onboardProductsTitle")}</h2>
            <p className="text-sm font-medium text-stone-600">{t(lang, "onboardProductsSub")}</p>
            <div className="grid grid-cols-2 gap-2">
              {FIRST_PRODUCT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => addTemplateProduct(tpl)}
                  className="min-h-[56px] rounded-2xl border-2 border-stone-200 bg-white px-3 py-2 text-sm font-black text-stone-900 active:bg-waka-50"
                >
                  + {t(lang, tpl.nameKey as "starterItem_sugar")}
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
