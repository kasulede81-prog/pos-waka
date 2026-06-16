import { Navigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Store, Sliders, Bell, KeyRound, Printer, Archive, Lock, ReceiptText, LayoutGrid, Pill, LifeBuoy, Activity, UtensilsCrossed, MonitorSmartphone, Stethoscope, UserCog } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageBackBar } from "../components/layout/PageBackBar";
import { OfficeNavSection } from "../components/office/OfficeNavSection";
import { OfficeNavCard } from "../components/office/OfficeNavCard";
import { ShopSupportNumberCard } from "../components/settings/ShopSupportNumberCard";
import { PilotSupportCard } from "../components/settings/PilotSupportCard";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { PilotModeToggle } from "../components/pilot/PilotModeToggle";
import { canTogglePilotMode, isPilotModeActive } from "../lib/pilotMode";
import { usePosStore } from "../store/usePosStore";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";

export function SettingsHubPage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  const actor = useSessionActor();
  const businessType = usePosStore((s) => s.preferences.businessType);
  const hospitalityModeEnabled = usePosStore((s) => s.preferences.hospitalityModeEnabled);
  const pharmacyModeEnabled = usePosStore((s) => s.preferences.pharmacyModeEnabled);
  const { userId, snapshot, authMode } = useSubscription();
  const planTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "—";
  const preferences = usePosStore((s) => s.preferences);

  if (searchParams.get("onboard") === "1") {
    return <Navigate to="/settings/shop?onboard=1" replace />;
  }

  if (!hasPermission(actor.role, "settings.view")) {
    return <Navigate to="/" replace />;
  }

  const canShop = hasPermission(actor.role, "settings.shop");
  const canReceipt = hasPermission(actor.role, "settings.receipt");
  const canDevices = hasPermission(actor.role, "settings.devices");
  const pilotActive = isPilotModeActive(actor.role, preferences);
  const showFloorSetup = canShop && isHospitalityMode(businessType, hospitalityModeEnabled);
  const showPharmacySettings = canShop && isPharmacyMode(businessType, pharmacyModeEnabled);
  const showHospitalitySettings = canShop && isHospitalityMode(businessType, hospitalityModeEnabled);

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "settingsHubTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "settingsHubSub")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">
          {t(lang, "settingsYourPlanLabel")}: <span className="font-black text-stone-900">{planTier}</span>
          <span className="mx-2 text-stone-300" aria-hidden>
            ·
          </span>
          {t(lang, "settingsAppVersionLine")}: <span className="font-mono font-black text-stone-900">{appVersion}</span>
        </p>
      </div>

      {canShop ? <ShopSupportNumberCard lang={lang} /> : null}

      <OfficeNavSection title={t(lang, "settingsHubGroupShop")}>
        {canShop ? (
          <OfficeNavCard
            to="/staff-access"
            title={t(lang, "officeCardStaffAccess")}
            subtitle={t(lang, "officeCardStaffAccessSub")}
            Icon={UserCog}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/shop"
            title={t(lang, "settingsHubShop")}
            subtitle={t(lang, "settingsHubShopSub")}
            Icon={Store}
          />
        ) : null}
        {canShop || canReceipt ? (
          <OfficeNavCard
            to="/settings/receipt"
            title={t(lang, "settingsHubReceipt")}
            subtitle={t(lang, "settingsHubReceiptSub")}
            Icon={ReceiptText}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/selling"
            title={t(lang, "settingsHubSelling")}
            subtitle={t(lang, "settingsHubSellingSub")}
            Icon={Sliders}
          />
        ) : null}
        {showFloorSetup ? (
          <OfficeNavCard
            to="/settings/floor"
            title={t(lang, "floorSetupTitle")}
            subtitle={t(lang, "floorSetupSub")}
            Icon={LayoutGrid}
          />
        ) : null}
        {showPharmacySettings ? (
          <OfficeNavCard
            to="/settings/pharmacy"
            title={t(lang, "settingsHubPharmacy")}
            subtitle={t(lang, "settingsHubPharmacySub")}
            Icon={Pill}
          />
        ) : null}
        {showHospitalitySettings ? (
          <OfficeNavCard
            to="/settings/hospitality"
            title={t(lang, "hospitalitySettingsTitle")}
            subtitle={t(lang, "hospitalitySettingsSub")}
            Icon={UtensilsCrossed}
          />
        ) : null}
        {canDevices ? (
          <OfficeNavCard
            to="/settings/devices"
            title={t(lang, "settingsHubDevices")}
            subtitle={t(lang, "settingsHubDevicesSub")}
            Icon={MonitorSmartphone}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/pin"
            title={t(lang, "settingsHubPin")}
            subtitle={t(lang, "settingsHubPinSub")}
            Icon={KeyRound}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/password"
            title={t(lang, "settingsHubPassword")}
            subtitle={t(lang, "settingsHubPasswordSub")}
            Icon={Lock}
          />
        ) : null}
        <OfficeNavCard
          to="/office/hardware"
          title={t(lang, "officeCardHardware")}
          subtitle={t(lang, "officeCardHardwareSub")}
          Icon={Printer}
        />
      </OfficeNavSection>

      <OfficeNavSection title={t(lang, "settingsHubGroupApp")}>
        <OfficeNavCard
          to="/settings/notifications"
          title={t(lang, "settingsHubNotifications")}
          subtitle={t(lang, "settingsHubNotificationsSub")}
          Icon={Bell}
        />
        {canShop ? (
          <OfficeNavCard
            to="/settings/health"
            title={t(lang, "settingsHubSystemHealth")}
            subtitle={t(lang, "settingsHubSystemHealthSub")}
            Icon={Activity}
          />
        ) : null}
        {canShop && Capacitor.isNativePlatform() ? (
          <OfficeNavCard
            to="/settings/diagnostics"
            title={t(lang, "settingsHubDiagnostics")}
            subtitle={t(lang, "settingsHubDiagnosticsSub")}
            Icon={Stethoscope}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/retention"
            title={t(lang, "settingsHubRetention")}
            subtitle={t(lang, "settingsHubRetentionSub")}
            Icon={Archive}
          />
        ) : null}
      </OfficeNavSection>

      {canTogglePilotMode(actor.role) ? <PilotModeToggle lang={lang} /> : null}
      {canTogglePilotMode(actor.role) ? (
        <OfficeNavCard
          to="/pilot-support"
          title={t(lang, "pilotSupportCenterTitle")}
          subtitle={t(lang, "pilotSupportCenterSub")}
          Icon={LifeBuoy}
        />
      ) : null}

      {pilotActive ? <SyncHealthCard lang={lang} variant="full" /> : null}
      {pilotActive ? <PilotSupportCard lang={lang} userId={userId} pilotModeEnabled /> : null}
    </div>
  );
}
