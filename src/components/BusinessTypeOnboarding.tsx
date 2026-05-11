import { useEffect, useState } from "react";
import type { BusinessType, Language } from "../types";
import { t } from "../lib/i18n";
import { BUSINESS_TYPE_IDS } from "../config/businessTypes";
import { usePosStore } from "../store/usePosStore";
import { saveBusinessProfileToCloud } from "../lib/businessProfile";

const DRAFT_KEY = "waka.business.onboarding.draft";

export function BusinessTypeOnboarding({ lang }: { lang: Language }) {
  const complete = usePosStore((s) => s.completeBusinessOnboarding);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const preferences = usePosStore((s) => s.preferences);
  const [shopName, setShopName] = useState(() => preferences.shopDisplayName ?? "");
  const [businessType, setBusinessType] = useState<BusinessType>(() => preferences.businessType ?? "kiosk_duka");
  const [currency, setCurrency] = useState(() => preferences.shopCurrency ?? "UGX");
  const [phone, setPhone] = useState(() => preferences.shopPhoneE164 ?? "");
  const [address, setAddress] = useState(() => preferences.shopAddressLine ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        shopName?: string;
        businessType?: BusinessType;
        currency?: string;
        phone?: string;
        address?: string;
      };
      if (d.shopName) setShopName(d.shopName);
      if (d.businessType) setBusinessType(d.businessType);
      if (d.currency) setCurrency(d.currency);
      if (d.phone) setPhone(d.phone);
      if (d.address) setAddress(d.address);
    } catch {
      /* ignore */
    }
  }, []);

  const persistDraft = (next: { shopName: string; businessType: BusinessType; currency: string; phone: string; address: string }) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
        <p className="text-center text-2xl font-black leading-tight text-slate-900">{t(lang, "onboardTitle")}</p>
        <p className="mt-2 text-center text-base text-slate-600">{t(lang, "onboardSubtitle")}</p>
        <div className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-slate-700">
            {t(lang, "businessName")}
            <input
              value={shopName}
              onChange={(e) => {
                const v = e.target.value;
                setShopName(v);
                persistDraft({ shopName: v, businessType, currency, phone, address });
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
                  persistDraft({ shopName, businessType: id, currency, phone, address });
                }}
                className={`rounded-2xl border-2 px-4 py-4 text-left text-base font-bold ${
                  businessType === id ? "border-waka-500 bg-waka-50 text-waka-900" : "border-slate-200 bg-slate-50 text-slate-900"
                }`}
              >
                {t(lang, `businessType_${id}`)}
              </button>
            ))}
          </div>
          <label className="block text-sm font-bold text-slate-700">
            {t(lang, "businessCurrency")}
            <input
              value={currency}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                setCurrency(v);
                persistDraft({ shopName, businessType, currency: v, phone, address });
              }}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            {t(lang, "personPhonePh")}
            <input
              value={phone}
              onChange={(e) => {
                const v = e.target.value;
                setPhone(v);
                persistDraft({ shopName, businessType, currency, phone: v, address });
              }}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            {t(lang, "shopAddress")}
            <input
              value={address}
              onChange={(e) => {
                const v = e.target.value;
                setAddress(v);
                persistDraft({ shopName, businessType, currency, phone, address: v });
              }}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
          </label>
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
                  shopCurrency: (currency || "UGX").toUpperCase(),
                });
                await saveBusinessProfileToCloud(
                  {
                    shopName: shopName.trim(),
                    businessType,
                    currency,
                    phone,
                    address,
                  },
                  true,
                );
                localStorage.removeItem(DRAFT_KEY);
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
    </div>
  );
}
