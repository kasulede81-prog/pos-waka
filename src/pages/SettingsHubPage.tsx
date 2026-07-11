import { actorHasPermission, actorHasEffectivePermission } from "../lib/actorAuthorization";
import { Navigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Activity, Archive, Banknote, Bell, Briefcase, Calculator, Fingerprint, Home, KeyRound, LayoutGrid, LifeBuoy, Lock, MonitorSmartphone, Palette, Pill, Printer, ReceiptText, ShieldCheck, Sliders, Stethoscope, Store, UserCog, UtensilsCrossed } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { useSessionActor } from "../context/SessionActorContext";

import { PageBackBar } from "../components/layout/PageBackBar";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
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
import { canSeeFinanceDiagnostics } from "../lib/financeVisibility";

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

  if (!actorHasPermission(actor, "settings.view")) {
    return <Navigate to="/" replace />;
  }

  const canShop = actorHasEffectivePermission(actor, "settings.shop", snapshot, authMode);
  const canDrawerSettings = actorHasPermission(actor, "day.open_drawer");
  const canOwnerFinanceDiagnostics =
    canSeeFinanceDiagnostics(actor.role) &&
    actorHasEffectivePermission(actor, "owner.dashboard", snapshot, authMode);
  const canArrangeShelves = actorHasPermission(actor, "shelves.customize");
  const canReceipt = actorHasPermission(actor, "settings.receipt");
  const canDevices = actorHasPermission(actor, "settings.devices");
  const pilotActive = isPilotModeActive(actor.role, preferences);
  const showFloorSetup = canShop && isHospitalityMode(businessType, hospitalityModeEnabled);
  const showPharmacySettings = canShop && isPharmacyMode(businessType, pharmacyModeEnabled);
  const showHospitalitySettings = canShop && isHospitalityMode(businessType, hospitalityModeEnabled);

  return (
    <BackOfficePageLayout
      header={
        <>
          <PageBackBar lang={lang} />
          <div className="mt-2">
            <h1 className="text-xl font-black text-foreground sm:text-2xl">{t(lang, "settingsHubTitle")}</h1>
            <p className="text-xs font-medium text-muted-foreground">{t(lang, "settingsHubSub")}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {t(lang, "settingsYourPlanLabel")}: <span className="font-black text-foreground">{planTier}</span>
              <span className="mx-2 text-muted-foreground" aria-hidden>
                ·
              </span>
              {t(lang, "settingsAppVersionLine")}: <span className="font-mono font-black text-foreground">{appVersion}</span>
            </p>
          </div>
        </>
      }
      className="pb-8"
    >
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
        {canDrawerSettings ? (
          <OfficeNavCard
            to="/settings/cash-drawer"
            title={t(lang, "cashManageDrawerSettings")}
            subtitle={t(lang, "cashManageDrawerSettingsSub")}
            Icon={Banknote}
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
        {canShop && actor.role === "owner" ? (
          <OfficeNavCard
            to="/settings/biometric"
            title={t(lang, "settingsHubBiometric")}
            subtitle={t(lang, "settingsHubBiometricSub")}
            Icon={Fingerprint}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/staff-roles"
            title={t(lang, "enterpriseRolesPageTitle")}
            subtitle={t(lang, "enterpriseRolesPageSub")}
            Icon={ShieldCheck}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/staff-security"
            title={t(lang, "settingsStaffSecurityTitle")}
            subtitle={t(lang, "settingsStaffSecuritySub")}
            Icon={Lock}
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
        {canShop ? (
          <OfficeNavCard
            to="/settings/home-menu"
            title={t(lang, "settingsHubHomeMenu")}
            subtitle={t(lang, "settingsHubHomeMenuSub")}
            Icon={Home}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/office-menu"
            title={t(lang, "settingsHubOfficeMenu")}
            subtitle={t(lang, "settingsHubOfficeMenuSub")}
            Icon={Briefcase}
          />
        ) : null}
        {canShop && canArrangeShelves ? (
          <OfficeNavCard
            to="/settings/shelves"
            title={t(lang, "settingsHubShelves")}
            subtitle={t(lang, "settingsHubShelvesSub")}
            Icon={LayoutGrid}
          />
        ) : null}
        <OfficeNavCard
          to="/settings/appearance"
          title={t(lang, "settingsHubAppearance")}
          subtitle={t(lang, "settingsHubAppearanceSub")}
          Icon={Palette}
        />
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
        {canOwnerFinanceDiagnostics ? (
          <OfficeNavCard
            to="/settings/finance-diagnostics"
            title={t(lang, "settingsHubFinanceDiagnostics")}
            subtitle={t(lang, "settingsHubFinanceDiagnosticsSub")}
            Icon={Calculator}
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
    </BackOfficePageLayout>
  );
}
