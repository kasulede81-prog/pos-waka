import { useEffect, useMemo, useState } from "react";
import type { BusinessType, Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { saveBusinessProfileToCloud } from "../lib/businessProfile";
import { getActiveAccountKey } from "../offline/accountScope";
import { SHOP_CURRENCY } from "../lib/shopCurrency";
import { AppModalOverlay } from "./layout/AppModalOverlay";
import {
  NON_HOSPITALITY_BUSINESS_TYPE_IDS,
  businessTypeForHospitalityStyle,
  hospitalityStyleIdForBusinessType,
  type HospitalityOnboardingStyleId,
} from "../config/hospitalityOnboarding";
import { isHospitalityBusinessType } from "../lib/hospitality";
import { useBusinessTypeVisibility } from "../hooks/useBusinessTypeVisibility";
import {
  filterHospitalityOnboardingStyles,
  filterNonHospitalityBusinessTypeIds,
  isHospitalityOnboardingVisible,
} from "../config/businessTypeVisibility";

const DRAFT_BASE_KEY = "waka.business.onboarding.draft";

function featureKeyForBusinessType(type: BusinessType): string {
  if (type === "wholesale") return "businessTypeFeatures_wholesale";
  if (type === "mini_supermarket") return "businessTypeFeatures_mini_supermarket";
  if (type === "boutique") return "businessTypeFeatures_boutique";
  if (type === "restaurant") return "businessTypeFeatures_restaurant";
  if (type === "bar") return "businessTypeFeatures_bar";
  if (type === "restaurant_bar") return "businessTypeFeatures_restaurant_bar";
  if (type === "hotel") return "businessTypeFeatures_hotel";
  if (type === "pharmacy") return "businessTypeFeatures_pharmacy";
  if (type === "hardware") return "businessTypeFeatures_hardware";
  if (type === "electronics") return "businessTypeFeatures_electronics";
  if (type === "salon") return "businessTypeFeatures_salon";
  if (type === "produce_market") return "businessTypeFeatures_produce_market";
  if (type === "mobile_money_agent") return "businessTypeFeatures_mobile_money_agent";
  if (type === "other") return "businessTypeFeatures_other";
  return "businessTypeFeatures_kiosk_duka";
}

function getDraftKey(): string | null {
  const acc = getActiveAccountKey();
  if (!acc) return null;
  return `${DRAFT_BASE_KEY}::${acc}`;
}

export function BusinessTypeOnboarding({ lang }: { lang: Language }) {
  const { settings: bizTypeSettings, isSuperAdmin: bizTypeSuperAdmin, loading: bizTypeSettingsLoading } =
    useBusinessTypeVisibility({ forRegistration: true });
  const visibleNonHospitalityIds = useMemo(
    () => filterNonHospitalityBusinessTypeIds(NON_HOSPITALITY_BUSINESS_TYPE_IDS, bizTypeSettings, bizTypeSuperAdmin),
    [bizTypeSettings, bizTypeSuperAdmin],
  );
  const visibleHospitalityStyles = useMemo(
    () => filterHospitalityOnboardingStyles(bizTypeSettings, bizTypeSuperAdmin),
    [bizTypeSettings, bizTypeSuperAdmin],
  );
  const showHospitalityGroup = isHospitalityOnboardingVisible(bizTypeSettings, bizTypeSuperAdmin);

  const complete = usePosStore((s) => s.completeBusinessOnboarding);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const preferences = usePosStore((s) => s.preferences);
  const [shopName, setShopName] = useState(() => preferences.shopDisplayName ?? "");
  const [businessType, setBusinessType] = useState<BusinessType>(() => preferences.businessType ?? "kiosk_duka");
  const [hospitalityFlow, setHospitalityFlow] = useState(() =>
    isHospitalityBusinessType(preferences.businessType ?? null),
  );
  const [hospitalityStyleId, setHospitalityStyleId] = useState<HospitalityOnboardingStyleId>(() => {
    return hospitalityStyleIdForBusinessType(preferences.businessType) ?? "restaurant";
  });
  const [phone, setPhone] = useState(() => preferences.shopPhoneE164 ?? "");
  const [address, setAddress] = useState(() => preferences.shopAddressLine ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const key = getDraftKey();
      if (!key) return;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        shopName?: string;
        businessType?: BusinessType;
        phone?: string;
        address?: string;
      };
      if (d.shopName) setShopName(d.shopName);
      if (d.businessType) {
        setBusinessType(d.businessType);
        const style = hospitalityStyleIdForBusinessType(d.businessType);
        if (style) {
          setHospitalityFlow(true);
          setHospitalityStyleId(style);
        } else {
          setHospitalityFlow(false);
        }
      }
      if (d.phone) setPhone(d.phone);
      if (d.address) setAddress(d.address);
    } catch {
      /* ignore */
    }
  }, []);

  const persistDraft = (next: { shopName: string; businessType: BusinessType; phone: string; address: string }) => {
    try {
      const key = getDraftKey();
      if (!key) return;
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const selectDirectType = (id: BusinessType) => {
    setHospitalityFlow(false);
    setBusinessType(id);
    persistDraft({ shopName, businessType: id, phone, address });
  };

  const selectHospitalityGroup = () => {
    setHospitalityFlow(true);
    const bt = businessTypeForHospitalityStyle(hospitalityStyleId);
    setBusinessType(bt);
    persistDraft({ shopName, businessType: bt, phone, address });
  };

  const selectHospitalityStyle = (styleId: HospitalityOnboardingStyleId) => {
    setHospitalityStyleId(styleId);
    const bt = businessTypeForHospitalityStyle(styleId);
    setBusinessType(bt);
    persistDraft({ shopName, businessType: bt, phone, address });
  };

  return (
    <AppModalOverlay className="z-[56] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <p className="text-center text-xs font-black uppercase tracking-[0.24em] text-waka-700">{t(lang, "wakaSlogan")}</p>
        <p className="mt-3 text-center text-3xl font-black leading-tight text-slate-900">{t(lang, "onboardTitle")}</p>
        <p className="mt-2 text-center text-base font-medium text-slate-600">{t(lang, "onboardSubtitle")}</p>
        <div className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-slate-700">
            {t(lang, "businessName")}
            <input
              value={shopName}
              onChange={(e) => {
                const v = e.target.value;
                setShopName(v);
                persistDraft({ shopName: v, businessType, phone, address });
              }}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              placeholder={t(lang, "businessName")}
            />
          </label>
          <p className="text-sm font-bold text-slate-700">{t(lang, "registerBusinessTypeLabel")}</p>
          {bizTypeSettingsLoading ? (
            <p className="text-sm font-semibold text-stone-500">{t(lang, "onboardBizLoading")}</p>
          ) : visibleNonHospitalityIds.length === 0 && !showHospitalityGroup ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
              {t(lang, "onboardBizNoneEnabled")}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {!bizTypeSettingsLoading &&
              visibleNonHospitalityIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => selectDirectType(id)}
                className={`rounded-2xl border-2 px-4 py-4 text-left text-base font-bold ${
                  !hospitalityFlow && businessType === id
                    ? "border-waka-500 bg-waka-50 text-waka-900"
                    : "border-slate-200 bg-slate-50 text-slate-900"
                }`}
              >
                {t(lang, `businessType_${id}`)}
              </button>
            ))}
            {!bizTypeSettingsLoading && showHospitalityGroup ? (
              <button
                type="button"
                onClick={selectHospitalityGroup}
                className={`rounded-2xl border-2 px-4 py-4 text-left text-base font-bold sm:col-span-2 ${
                  hospitalityFlow
                    ? "border-waka-500 bg-waka-50 text-waka-900"
                    : "border-slate-200 bg-slate-50 text-slate-900"
                }`}
              >
                {t(lang, "onboardBiz_hospitality")}
              </button>
            ) : null}
          </div>
          {hospitalityFlow ? (
            <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm font-black text-stone-900">{t(lang, "onboardHospitalityStyleTitle")}</p>
              <p className="mt-1 text-xs font-medium text-stone-600">{t(lang, "onboardHospitalityStyleSub")}</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleHospitalityStyles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => selectHospitalityStyle(style.id)}
                    className={`rounded-2xl border-2 px-3 py-3 text-left text-sm font-bold ${
                      hospitalityStyleId === style.id
                        ? "border-waka-500 bg-waka-50 text-waka-900"
                        : "border-stone-200 bg-white text-stone-900"
                    }`}
                  >
                    <span className="mr-1">{style.emoji}</span>
                    {t(lang, style.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-3xl border border-waka-100 bg-waka-50/70 p-4">
            <p className="text-sm font-black text-waka-950">{t(lang, "businessTypeFeaturesTitle")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {t(lang, featureKeyForBusinessType(businessType))
                .split("|")
                .map((feature) => (
                  <span key={feature} className="rounded-full bg-white px-3 py-2 text-xs font-black text-waka-900 shadow-sm">
                    {feature}
                  </span>
                ))}
            </div>
          </div>
          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-black text-slate-800">{t(lang, "onboardOptionalDetails")}</summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm font-semibold text-slate-600">{t(lang, "currencyUgxOnly")}</p>
              <label className="block text-sm font-bold text-slate-700">
                {t(lang, "personPhonePh")}
                <input
                  value={phone}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPhone(v);
                    persistDraft({ shopName, businessType, phone: v, address });
                  }}
                  className="mt-1 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg"
                />
              </label>
              <label className="block text-sm font-bold text-slate-700">
                {t(lang, "shopAddress")}
                <input
                  value={address}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAddress(v);
                    persistDraft({ shopName, businessType, phone, address: v });
                  }}
                  className="mt-1 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg"
                />
              </label>
            </div>
          </details>
          {err ? <p className="text-sm font-bold text-rose-700">{err}</p> : null}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              if (!shopName.trim()) {
                setErr(t(lang, "shopNameRequired"));
                return;
              }
              const resolvedType = hospitalityFlow
                ? businessTypeForHospitalityStyle(hospitalityStyleId)
                : businessType;
              setBusy(true);
              try {
                complete(resolvedType);
                setPreferences({
                  shopDisplayName: shopName.trim(),
                  shopPhoneE164: phone.trim() || null,
                  shopAddressLine: address.trim() || null,
                  shopCurrency: SHOP_CURRENCY,
                });
                await saveBusinessProfileToCloud(
                  {
                    shopName: shopName.trim(),
                    businessType: resolvedType,
                    currency: SHOP_CURRENCY,
                    phone,
                    address,
                  },
                  true,
                );
                const key = getDraftKey();
                if (key) localStorage.removeItem(key);
              } catch {
                setErr(t(lang, "businessProfileSaveFailed"));
              } finally {
                setBusy(false);
              }
            }}
            className="min-h-[52px] w-full rounded-2xl bg-waka-600 px-4 py-3 text-lg font-black text-white"
          >
            {busy ? "…" : t(lang, "saveAndContinue")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
