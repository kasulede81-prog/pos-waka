import { useEffect, useState } from "react";
import type { BusinessType, Language } from "../types";
import { t } from "../lib/i18n";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";
import { usePosStore } from "../store/usePosStore";
import { saveBusinessProfileToCloud } from "../lib/businessProfile";
import { getActiveAccountKey } from "../offline/accountScope";
import { SHOP_CURRENCY } from "../lib/shopCurrency";
import { AppModalOverlay } from "./layout/AppModalOverlay";

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
  const complete = usePosStore((s) => s.completeBusinessOnboarding);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const preferences = usePosStore((s) => s.preferences);
  const [shopName, setShopName] = useState(() => preferences.shopDisplayName ?? "");
  const [businessType, setBusinessType] = useState<BusinessType>(() => preferences.businessType ?? "kiosk_duka");
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
      if (d.businessType) setBusinessType(d.businessType);
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {BUSINESS_TYPE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setBusinessType(id);
                  persistDraft({ shopName, businessType: id, phone, address });
                }}
                className={`rounded-2xl border-2 px-4 py-4 text-left text-base font-bold ${
                  businessType === id ? "border-waka-500 bg-waka-50 text-waka-900" : "border-slate-200 bg-slate-50 text-slate-900"
                }`}
              >
                {t(lang, `businessType_${id}`)}
              </button>
            ))}
          </div>
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
              setBusy(true);
              try {
                complete(businessType);
                setPreferences({
                  shopDisplayName: shopName.trim(),
                  shopPhoneE164: phone.trim() || null,
                  shopAddressLine: address.trim() || null,
                  shopCurrency: SHOP_CURRENCY,
                });
                await saveBusinessProfileToCloud(
                  {
                    shopName: shopName.trim(),
                    businessType,
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
