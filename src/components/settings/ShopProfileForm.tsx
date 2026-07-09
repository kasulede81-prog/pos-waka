import { useCallback, useEffect, useState, type ReactNode } from "react";
import { actorHasPermission } from "../../lib/actorAuthorization";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../../types";
import { supabase } from "../../lib/supabase";
import { t } from "../../lib/i18n";
import { wakaSupportWhatsAppUrl } from "../../config/company";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";

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

const fieldClass =
  "mt-1.5 w-full min-h-[44px] rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base outline-none ring-waka-200 focus:border-waka-400 focus:ring-2 disabled:bg-stone-50 disabled:text-stone-600";

function ProfileSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white px-4 py-3.5 shadow-sm">
      <h2 className="text-sm font-black text-stone-900">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs font-medium text-stone-500">{hint}</p> : null}
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </section>
  );
}

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

  const supportWhatsApp = wakaSupportWhatsAppUrl(
    "Hello Waka, I need to update my shop business profile (name, phone, or location).",
  );

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
    if (authMode !== "supabase" || !actorHasPermission(actor, "settings.shop")) return;
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

  if (!actorHasPermission(actor, "settings.shop")) return null;

  return (
    <div className="space-y-3">
      {showOnboardGate ? (
        <p className="rounded-xl border border-waka-200 bg-waka-50 px-3 py-2 text-sm font-bold text-waka-950">
          {t(lang, "onboardingUrlGateTitle")}
        </p>
      ) : null}

      {profileLocked ? (
        <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-3 text-sm text-stone-800">
          <p className="font-semibold text-stone-900">{t(lang, "shopProfileProtectedTitle")}</p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-stone-600">
            {t(lang, "shopProfileProtectedBody")}
          </p>
          <a
            href={supportWhatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-[40px] items-center rounded-lg bg-emerald-600 px-3 text-xs font-black text-white"
          >
            {t(lang, "shopProfileContactSupport")}
          </a>
        </div>
      ) : null}

      {needsRecoveryEmail ? (
        <ProfileSection title={t(lang, "registerEmailLabel")} hint={t(lang, "registerEmailRequiredHint")}>
          <input
            type="email"
            value={recoveryEmailInput}
            onChange={(e) => setRecoveryEmailInput(e.target.value)}
            autoComplete="email"
            className={fieldClass}
          />
        </ProfileSection>
      ) : null}

      <ProfileSection title={t(lang, "shopProfileShopNameLabel")}>
        <input
          value={shopNameInput}
          onChange={(e) => setShopNameInput(e.target.value)}
          readOnly={profileLocked}
          disabled={profileLocked}
          className={fieldClass}
          autoComplete="organization"
        />
      </ProfileSection>

      <ProfileSection title={t(lang, "shopProfilePhoneLabel")} hint={t(lang, "shopProfilePhoneHint")}>
        <input
          value={shopPhoneInput}
          onChange={(e) => setShopPhoneInput(e.target.value)}
          readOnly={profileLocked}
          disabled={profileLocked}
          inputMode="tel"
          autoComplete="tel"
          className={fieldClass}
        />
      </ProfileSection>

      {authMode === "supabase" ? (
        <ProfileSection title={t(lang, "shopProfileLocationTitle")} hint={t(lang, "shopLocationSectionHelp")}>
          <label className="block text-xs font-bold text-stone-700">{t(lang, "shopDistrictLabel")}</label>
          <select
            value={districtIdSel}
            onChange={(e) => setDistrictIdSel(e.target.value)}
            disabled={profileLocked}
            className={fieldClass}
          >
            <option value="">—</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <label className="block text-xs font-bold text-stone-700">{t(lang, "shopCityLabel")}</label>
          <input
            value={shopCityField}
            onChange={(e) => setShopCityField(e.target.value)}
            readOnly={profileLocked}
            disabled={profileLocked}
            className={fieldClass}
          />
          <label className="block text-xs font-bold text-stone-700">{t(lang, "shopAreaLabel")}</label>
          <input
            value={shopAreaField}
            onChange={(e) => setShopAreaField(e.target.value)}
            readOnly={profileLocked}
            disabled={profileLocked}
            className={fieldClass}
          />
          <label className="block text-xs font-bold text-stone-700">{t(lang, "shopProfileLandmarkLabel")}</label>
          <input
            value={shopAddressInput}
            onChange={(e) => setShopAddressInput(e.target.value)}
            readOnly={profileLocked}
            disabled={profileLocked}
            placeholder={t(lang, "shopProfileLandmarkPh")}
            className={fieldClass}
          />
          {!profileLocked ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="min-h-[40px] flex-1 rounded-xl bg-waka-600 px-3 text-xs font-black text-white"
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
                className="min-h-[40px] rounded-xl border border-stone-200 bg-white px-3 text-xs font-black text-stone-800"
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
          ) : null}
          {gpsHint ? <p className="text-xs font-semibold text-stone-600">{gpsHint}</p> : null}
        </ProfileSection>
      ) : (
        <ProfileSection title={t(lang, "shopProfileLocationTitle")}>
          <input
            value={shopAddressInput}
            onChange={(e) => setShopAddressInput(e.target.value)}
            readOnly={profileLocked}
            disabled={profileLocked}
            className={fieldClass}
          />
        </ProfileSection>
      )}

      <ProfileSection title={t(lang, "shopProfileBusinessTypeLabel")} hint={t(lang, "businessTypeLockedMessage")}>
        <p className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-sm font-semibold text-stone-800">
          {t(lang, `businessType_${preferences.businessType}`)}
        </p>
      </ProfileSection>

      <ProfileSection title={t(lang, "businessCurrency")}>
        <p className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-sm font-black text-stone-800">
          {t(lang, "currencyUgxOnly")} ({shopCurrencyLabel})
        </p>
      </ProfileSection>

      {profileFeedback ? (
        <p className="text-sm font-semibold text-waka-900">{profileFeedback}</p>
      ) : null}
      {profileSaveError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
          {profileSaveError}
        </p>
      ) : null}

      {!profileLocked ? (
        <button
          type="button"
          disabled={profileBusy}
          onClick={() => void saveBusinessProfileClick()}
          className="min-h-[48px] w-full rounded-xl bg-waka-600 py-3 text-base font-black text-white disabled:opacity-50"
        >
          {profileBusy ? "…" : t(lang, "saveBusinessProfile")}
        </button>
      ) : null}
    </div>
  );
}
