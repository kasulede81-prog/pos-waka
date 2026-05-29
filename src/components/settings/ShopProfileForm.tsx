import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../../types";
import { supabase } from "../../lib/supabase";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import {
  fetchOwnerOnboardingStatus,
  type OwnerOnboardingStatus,
} from "../../lib/ownerOnboarding";
import {
  finalizeOwnerOnboardingAfterCloudSave,
  loadPrimaryShopLocationFromCloud,
  messageForProfileSaveError,
  normalizeUgPhoneE164,
  saveBusinessProfileToCloud,
  saveOwnerBusinessProfileBundleRpc,
} from "../../lib/businessProfile";
import { fetchDistricts, type DistrictRow } from "../../lib/shopDistricts";
import { DeviceLocationRequestError, getDevicePosition } from "../../lib/deviceLocation";
import { SHOP_CURRENCY } from "../../lib/shopCurrency";

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
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [shopNameInput, setShopNameInput] = useState(preferences.shopDisplayName ?? shopName ?? "");
  const [shopPhoneInput, setShopPhoneInput] = useState(preferences.shopPhoneE164 ?? "");
  const [shopAddressInput, setShopAddressInput] = useState(preferences.shopAddressLine ?? "");
  const shopCurrencyLabel = preferences.shopCurrency ?? "UGX";
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtIdSel, setDistrictIdSel] = useState("");
  const [shopCityField, setShopCityField] = useState("");
  const [shopAreaField, setShopAreaField] = useState("");
  const [shopLat, setShopLat] = useState<number | null>(null);
  const [shopLng, setShopLng] = useState<number | null>(null);
  const [gpsHint, setGpsHint] = useState<string | null>(null);
  const [recordGpsSnapshot, setRecordGpsSnapshot] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<OwnerOnboardingStatus | null>(null);

  const profileLocked = authMode === "supabase" && onboardingStatus?.complete === true;
  const needsRecoveryEmail =
    authMode === "supabase" && !profileLocked && onboardingStatus?.missing.includes("email");
  const [recoveryEmailInput, setRecoveryEmailInput] = useState(() => {
    const e = (email ?? user?.email ?? "").trim().toLowerCase();
    return e.includes("@") && !e.endsWith("@login.waka.ug") ? e : "";
  });

  const ownerDisplayName =
    String((user?.user_metadata as Record<string, unknown> | undefined)?.full_name ?? "").trim() ||
    (email ? email.split("@")[0] : "");

  const saveBusinessProfileClick = useCallback(async () => {
    setProfileFeedback(null);
    setProfileSaveError(null);
    if (profileLocked) {
      setProfileFeedback(t(lang, "shopProfileLockedMessage"));
      return;
    }
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
      if (needsRecoveryEmail) {
        const em = recoveryEmailInput.trim().toLowerCase();
        if (!em.includes("@") || em.endsWith("@login.waka.ug")) {
          setProfileFeedback(t(lang, "registerEmailInvalid"));
          return;
        }
      }
    }
    setProfileBusy(true);
    try {
      setPreferences({
        shopDisplayName: shopNameInput.trim(),
        shopPhoneE164: shopPhoneInput.trim() || null,
        shopAddressLine: shopAddressInput.trim() || null,
        shopCurrency: SHOP_CURRENCY,
      });
      if (authMode === "supabase") {
        const ph = normalizeUgPhoneE164(shopPhoneInput);
        if (!ph || !districtIdSel) throw new Error(t(lang, "registerFieldRequired"));
        if (needsRecoveryEmail && user?.id && supabase) {
          const em = recoveryEmailInput.trim().toLowerCase();
          const { error: emErr } = await supabase.from("profiles").update({ email: em }).eq("id", user.id);
          if (emErr) throw emErr;
        }
        const rpc = await saveOwnerBusinessProfileBundleRpc({
          shopName: shopNameInput.trim(),
          businessType: preferences.businessType,
          districtId: districtIdSel,
          phoneE164: ph,
          currency: SHOP_CURRENCY,
          address: shopAddressInput,
          city: shopCityField,
          area: shopAreaField,
          latitude: shopLat,
          longitude: shopLng,
        });
        if (!rpc.ok) throw new Error(messageForProfileSaveError(rpc.message ?? "save_failed", lang));
        if (user?.id) await finalizeOwnerOnboardingAfterCloudSave(user.id);
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
            currency: SHOP_CURRENCY,
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
      if (authMode === "supabase") {
        setOnboardingStatus({ complete: true, missing: [] });
      }
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[waka-settings] business profile save failed", e);
      const friendly = messageForProfileSaveError(msg, lang);
      setProfileSaveError(friendly || t(lang, "businessProfileSaveFailed"));
      setProfileFeedback(friendly || t(lang, "businessProfileSaveFailed"));
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
    shopLat,
    shopLng,
    shopNameInput,
    shopPhoneInput,
    profileLocked,
    needsRecoveryEmail,
    recoveryEmailInput,
    user?.id,
    user?.user_metadata,
  ]);

  useEffect(() => {
    if (authMode !== "supabase") return;
    let cancelled = false;
    void fetchOwnerOnboardingStatus().then((s) => {
      if (!cancelled && s) setOnboardingStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [authMode]);

  useEffect(() => {
    if (authMode !== "supabase" || !hasPermission(actor.role, "settings.shop")) return;
    let cancelled = false;
    void (async () => {
      const { districts: d } = await fetchDistricts();
      if (cancelled) return;
      setDistricts(d);
      const loc = await loadPrimaryShopLocationFromCloud();
      if (cancelled || !loc) return;
      if (loc.shopName?.trim()) setShopNameInput(loc.shopName.trim());
      if (loc.phoneE164?.trim()) setShopPhoneInput(loc.phoneE164.trim());
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
    if (authMode !== "supabase" || !user) return;
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const metaShop =
      String(meta?.shop_display_name ?? meta?.shop_name ?? meta?.business_name ?? "").trim();
    const metaPhone = String(meta?.phone_e164 ?? meta?.phone ?? "").trim();
    if (metaShop && !shopNameInput.trim()) setShopNameInput(metaShop);
    if (metaPhone && !shopPhoneInput.trim()) setShopPhoneInput(metaPhone);
  }, [authMode, user, shopNameInput, shopPhoneInput]);

  if (!hasPermission(actor.role, "settings.shop")) return null;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      {showOnboardGate ? (
        <p className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-950">
          {t(lang, "onboardingUrlGateTitle")}
        </p>
      ) : null}
      {profileLocked ? (
        <p className="mb-4 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm font-semibold text-stone-800">
          {t(lang, "shopProfileLockedMessage")}
        </p>
      ) : null}
      {needsRecoveryEmail ? (
        <>
          <label className="block text-sm font-bold text-slate-800">{t(lang, "registerEmailLabel")}</label>
          <input
            type="email"
            value={recoveryEmailInput}
            onChange={(e) => setRecoveryEmailInput(e.target.value)}
            autoComplete="email"
            className="mt-1 w-full rounded-2xl border-2 border-orange-300 bg-orange-50/50 px-4 py-3 text-lg"
          />
          <p className="mt-1 text-xs font-semibold text-orange-900">{t(lang, "registerEmailRequiredHint")}</p>
        </>
      ) : null}
      <label className="block text-sm font-bold text-slate-800">{t(lang, "businessName")}</label>
      <input
        value={shopNameInput}
        onChange={(e) => setShopNameInput(e.target.value)}
        readOnly={profileLocked}
        disabled={profileLocked}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg disabled:bg-stone-100"
      />
      <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "personPhonePh")}</label>
      <input
        value={shopPhoneInput}
        onChange={(e) => setShopPhoneInput(e.target.value)}
        readOnly={profileLocked}
        disabled={profileLocked}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg disabled:bg-stone-100"
      />
      <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopAddress")}</label>
      <input
        value={shopAddressInput}
        onChange={(e) => setShopAddressInput(e.target.value)}
        readOnly={profileLocked}
        disabled={profileLocked}
        className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg disabled:bg-stone-100"
      />

      {authMode === "supabase" ? (
        <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/50 p-3">
          <p className="text-sm font-black text-orange-950">{t(lang, "shopLocationSectionTitle")}</p>
          <label className="mt-3 block text-sm font-bold text-slate-800">{t(lang, "shopDistrictLabel")}</label>
          <select
            value={districtIdSel}
            onChange={(e) => setDistrictIdSel(e.target.value)}
            disabled={profileLocked}
            className="mt-1 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold disabled:bg-stone-100"
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
                void (async () => {
                  try {
                    const pos = await getDevicePosition();
                    setShopLat(pos.latitude);
                    setShopLng(pos.longitude);
                    setRecordGpsSnapshot(true);
                    setGpsHint(t(lang, "shopGpsSaved"));
                  } catch (err) {
                    if (err instanceof DeviceLocationRequestError && err.reason === "unsupported") {
                      setGpsHint(t(lang, "shopGpsNotSupported"));
                    } else {
                      setGpsHint(t(lang, "shopGpsDenied"));
                    }
                  }
                })();
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

      <p className="mt-3 text-sm font-bold text-slate-800">{t(lang, "businessCurrency")}</p>
      <p className="mt-1 rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-lg font-black text-slate-800">
        {t(lang, "currencyUgxOnly")} ({shopCurrencyLabel})
      </p>
      <p className="mt-3 text-xs font-bold text-stone-500">{t(lang, "businessTypeLockedMessage")}</p>
      <p className="text-sm font-semibold text-stone-700">{t(lang, `businessType_${preferences.businessType}`)}</p>

      {profileFeedback ? <p className="mt-3 text-sm font-bold text-waka-900">{profileFeedback}</p> : null}
      {profileSaveError ? (
        <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
          {profileSaveError}
        </p>
      ) : null}
      {!profileLocked ? (
        <button
          type="button"
          disabled={profileBusy}
          onClick={() => void saveBusinessProfileClick()}
          className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white disabled:opacity-50"
        >
          {profileBusy ? "…" : t(lang, "saveBusinessProfile")}
        </button>
      ) : null}
    </article>
  );
}
