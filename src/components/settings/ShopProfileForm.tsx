import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../../types";
import { supabase } from "../../lib/supabase";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import {
  loadPrimaryShopLocationFromCloud,
  normalizeUgPhoneE164,
  saveBusinessProfileToCloud,
  saveOwnerBusinessProfileBundleRpc,
} from "../../lib/businessProfile";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { fetchDistricts, type DistrictRow } from "../../lib/shopDistricts";

type Props = {
  lang: Language;
  authMode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  shopName?: string | null;
  showOnboardGate?: boolean;
  onSaved?: () => void;
};

export function ShopProfileForm({ lang, authMode, user, email, shopName, showOnboardGate, onSaved }: Props) {
  const { isOnline } = useOfflineStatus();
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [shopNameInput, setShopNameInput] = useState(preferences.shopDisplayName ?? shopName ?? "");
  const [shopPhoneInput, setShopPhoneInput] = useState(preferences.shopPhoneE164 ?? "");
  const [shopAddressInput, setShopAddressInput] = useState(preferences.shopAddressLine ?? "");
  const [shopCurrencyInput, setShopCurrencyInput] = useState(preferences.shopCurrency ?? "UGX");
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtIdSel, setDistrictIdSel] = useState("");
  const [shopCityField, setShopCityField] = useState("");
  const [shopAreaField, setShopAreaField] = useState("");
  const [shopLat, setShopLat] = useState<number | null>(null);
  const [shopLng, setShopLng] = useState<number | null>(null);
  const [gpsHint, setGpsHint] = useState<string | null>(null);
  const [recordGpsSnapshot, setRecordGpsSnapshot] = useState(false);
  const wasOfflineRef = useRef(false);

  const ownerDisplayName =
    String((user?.user_metadata as Record<string, unknown> | undefined)?.full_name ?? "").trim() ||
    (email ? email.split("@")[0] : "");

  const saveBusinessProfileClick = useCallback(async () => {
    setProfileFeedback(null);
    setProfileSaveError(null);
    if (!shopNameInput.trim()) {
      setProfileFeedback(t(lang, "shopNameRequired"));
      return;
    }
    if (authMode === "supabase") {
      if (!districtIdSel) {
        setProfileFeedback(t(lang, "businessProfileDistrictRequired"));
        return;
      }
      const ph = normalizeUgPhoneE164(shopPhoneInput);
      if (!ph) {
        setProfileFeedback(t(lang, "registerPhoneInvalid"));
        return;
      }
    }
    setProfileBusy(true);
    try {
      setPreferences({
        shopDisplayName: shopNameInput.trim(),
        shopPhoneE164: shopPhoneInput.trim() || null,
        shopAddressLine: shopAddressInput.trim() || null,
        shopCurrency: shopCurrencyInput.trim().toUpperCase() || "UGX",
      });
      if (authMode === "supabase") {
        const ph = normalizeUgPhoneE164(shopPhoneInput);
        if (!ph || !districtIdSel) throw new Error(t(lang, "registerFieldRequired"));
        const rpc = await saveOwnerBusinessProfileBundleRpc({
          shopName: shopNameInput.trim(),
          businessType: preferences.businessType,
          districtId: districtIdSel,
          phoneE164: ph,
          currency: shopCurrencyInput.trim().toUpperCase() || "UGX",
          address: shopAddressInput,
          city: shopCityField,
          area: shopAreaField,
          latitude: shopLat,
          longitude: shopLng,
        });
        if (!rpc.ok) throw new Error(rpc.message ?? t(lang, "businessProfileSaveFailed"));
        if (recordGpsSnapshot && shopLat != null && shopLng != null && supabase && rpc.shopId) {
          const { error: locErr } = await supabase.from("shop_locations").insert({
            shop_id: rpc.shopId,
            latitude: shopLat,
            longitude: shopLng,
            source: "device_gps",
            is_primary: true,
          });
          if (locErr) console.error("[waka-settings] shop_locations insert", locErr);
        }
      } else {
        await saveBusinessProfileToCloud(
          {
            shopName: shopNameInput.trim(),
            businessType: preferences.businessType,
            currency: shopCurrencyInput,
            phone: shopPhoneInput,
            address: shopAddressInput,
            ownerName: ownerDisplayName || undefined,
            applyShopLocation: false,
            districtId: districtIdSel || null,
            city: shopCityField,
            area: shopAreaField,
            latitude: shopLat,
            longitude: shopLng,
            recordGpsInHistory: recordGpsSnapshot && shopLat != null && shopLng != null,
          },
          false,
        );
      }
      setRecordGpsSnapshot(false);
      setProfileSaveError(null);
      setProfileFeedback(t(lang, "businessProfileSaved"));
      window.dispatchEvent(new CustomEvent("waka:onboarding-updated"));
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[waka-settings] business profile save failed", e);
      setProfileSaveError(msg || t(lang, "businessProfileSaveFailed"));
      setProfileFeedback(t(lang, "businessProfileSaveFailed"));
    } finally {
      setProfileBusy(false);
    }
  }, [
    authMode,
    districtIdSel,
    email,
    lang,
    onSaved,
    preferences.businessType,
    recordGpsSnapshot,
    setPreferences,
    shopAddressInput,
    shopAreaField,
    shopCityField,
    shopCurrencyInput,
    shopLat,
    shopLng,
    shopNameInput,
    shopPhoneInput,
    user?.user_metadata,
  ]);

  useEffect(() => {
    if (authMode !== "supabase" || !hasPermission(actor.role, "settings.shop")) return;
    let cancelled = false;
    void (async () => {
      const { districts: d } = await fetchDistricts();
      if (cancelled) return;
      setDistricts(d);
      const loc = await loadPrimaryShopLocationFromCloud();
      if (cancelled || !loc) return;
      setDistrictIdSel(loc.districtId ?? "");
      setShopCityField(loc.city ?? "");
      setShopAreaField(loc.area ?? "");
      setShopLat(loc.latitude);
      setShopLng(loc.longitude);
    })();
    return () => {
      cancelled = true;
    };
  }, [authMode, actor.role]);

  useEffect(() => {
    if (!isOnline) wasOfflineRef.current = true;
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline || authMode !== "supabase" || profileBusy) return;
    if (!wasOfflineRef.current) return;
    if (!profileSaveError) return;
    const net = /failed to fetch|networkerror|network request failed|load failed|offline|timed out|timeout/i.test(
      profileSaveError,
    );
    if (!net) return;
    wasOfflineRef.current = false;
    void saveBusinessProfileClick();
  }, [isOnline, authMode, profileBusy, profileSaveError, saveBusinessProfileClick]);

  if (!hasPermission(actor.role, "settings.shop")) return null;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      {showOnboardGate ? (
        <p className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-950">
          {t(lang, "onboardingUrlGateTitle")}
        </p>
      ) : null}
      <label className="block text-sm font-bold text-slate-800">{t(lang, "businessName")}</label>
      <input
        value={shopNameInput}
        onChange={(e) => setShopNameInput(e.target.value)}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
      />
      <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "personPhonePh")}</label>
      <input
        value={shopPhoneInput}
        onChange={(e) => setShopPhoneInput(e.target.value)}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
      />
      <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopAddress")}</label>
      <input
        value={shopAddressInput}
        onChange={(e) => setShopAddressInput(e.target.value)}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
      />

      {authMode === "supabase" ? (
        <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/50 p-3">
          <p className="text-sm font-black text-orange-950">{t(lang, "shopLocationSectionTitle")}</p>
          <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopDistrictLabel")}</label>
          <select
            value={districtIdSel}
            onChange={(e) => setDistrictIdSel(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold"
          >
            <option value="">—</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopCityLabel")}</label>
          <input
            value={shopCityField}
            onChange={(e) => setShopCityField(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
          />
          <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopAreaLabel")}</label>
          <input
            value={shopAreaField}
            onChange={(e) => setShopAreaField(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-[44px] rounded-2xl bg-waka-600 py-2.5 text-sm font-black text-white"
              onClick={() => {
                setGpsHint(null);
                setRecordGpsSnapshot(false);
                if (!("geolocation" in navigator)) {
                  setGpsHint(t(lang, "shopGpsNotSupported"));
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setShopLat(pos.coords.latitude);
                    setShopLng(pos.coords.longitude);
                    setRecordGpsSnapshot(true);
                    setGpsHint(t(lang, "shopGpsSaved"));
                  },
                  () => setGpsHint(t(lang, "shopGpsDenied")),
                  { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
                );
              }}
            >
              {t(lang, "shopUseGps")}
            </button>
            <button
              type="button"
              className="min-h-[44px] rounded-2xl border-2 border-stone-300 bg-white py-2.5 text-sm font-black text-stone-800"
              onClick={() => {
                setShopLat(null);
                setShopLng(null);
                setRecordGpsSnapshot(false);
                setGpsHint(null);
              }}
            >
              {t(lang, "shopSkipGps")}
            </button>
          </div>
          {gpsHint ? <p className="mt-2 text-sm font-semibold text-stone-700">{gpsHint}</p> : null}
        </div>
      ) : null}

      <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "businessCurrency")}</label>
      <input
        value={shopCurrencyInput}
        onChange={(e) => setShopCurrencyInput(e.target.value.toUpperCase())}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
      />
      <p className="mt-3 text-xs font-bold text-stone-500">{t(lang, "businessTypeLockedMessage")}</p>
      <p className="text-sm font-semibold text-stone-700">{t(lang, `businessType_${preferences.businessType}`)}</p>

      {profileFeedback ? <p className="mt-3 text-sm font-bold text-waka-900">{profileFeedback}</p> : null}
      {profileSaveError ? (
        <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
          {profileSaveError}
        </p>
      ) : null}
      <button
        type="button"
        disabled={profileBusy}
        onClick={() => void saveBusinessProfileClick()}
        className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white disabled:opacity-50"
      >
        {profileBusy ? "…" : t(lang, "saveBusinessProfile")}
      </button>
    </article>
  );
}
