import { useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { canAccessSettingsCapability, type SettingsCapabilityId } from "../lib/settingsCapabilityMatrix";
import { Navigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Activity, Archive, Banknote, Bell, Briefcase, Calculator, Camera, Fingerprint, Home, KeyRound, LayoutGrid, LifeBuoy, Lock, MonitorSmartphone, Palette, Pill, Printer, ReceiptText, Search, Sliders, Stethoscope, Store, UserCog, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { isHospitalityMode } from "../lib/hospitality";
import { isPharmacyMode } from "../lib/pharmacy";
import { authOperatorRole } from "../lib/sessionActor";
import { useSessionActor } from "../context/SessionActorContext";

import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { Body, MonoNumber } from "../components/enterprise/EnterpriseTypography";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { OfficeNavSection } from "../components/office/OfficeNavSection";
import { OfficeNavCard } from "../components/office/OfficeNavCard";
import { ShopSupportNumberCard } from "../components/settings/ShopSupportNumberCard";
import { PilotSupportCard } from "../components/settings/PilotSupportCard";
import { RemoteSupportStatusCard } from "../components/remote-support/RemoteSupportStatusCard";
import { useSupportUnreadCounts } from "../hooks/useMerchantSupport";
import { useActiveShopId } from "../hooks/useActiveShopId";
import { SyncHealthCard } from "../components/SyncHealthCard";
import { PilotModeToggle } from "../components/pilot/PilotModeToggle";
import { canTogglePilotMode, isPilotModeActive } from "../lib/pilotMode";
import { usePosStore } from "../store/usePosStore";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { canSeeFinanceDiagnostics } from "../lib/financeVisibility";
import { useShopVisionSettings } from "../hooks/useShopVisionSettings";

/**
 * Settings hub — vertical-slice reconciliation of the Lovable modernization.
 *
 * WHAT CHANGED (presentation only): destinations are grouped by intent
 * (Business, POS & sales, Inventory, Staff & access, Devices & hardware, App &
 * appearance, System & data, Support) and filterable by a label search box.
 *
 * WHAT DID NOT CHANGE: every guard, permission derivation, capability check,
 * data source, route target, and trailing rendering (PilotModeToggle, pilot
 * support card, SyncHealthCard, PilotSupportCard) is canonical. Routing stays
 * on react-router-dom — the snapshot's routerCompat shim is not adopted.
 */
type SettingsNavItem = {
  to: string;
  title: string;
  subtitle?: string;
  Icon: LucideIcon;
  show: boolean;
  highlight?: boolean;
  trailing?: string;
};

type SettingsNavGroup = { id: string; title: string; items: SettingsNavItem[] };

export function SettingsHubPage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  const actor = useSessionActor();
  const businessType = usePosStore((s) => s.preferences.businessType);
  const hospitalityModeEnabled = usePosStore((s) => s.preferences.hospitalityModeEnabled);
  const pharmacyModeEnabled = usePosStore((s) => s.preferences.pharmacyModeEnabled);
  const { userId, snapshot, authMode } = useSubscription();
  const { access: visionAccess } = useShopVisionSettings();
  const { shopId: activeShopId, loading: activeShopLoading } = useActiveShopId();
  const unreadCounts = useSupportUnreadCounts(activeShopLoading ? null : activeShopId);
  const supportAttentionTotal =
    (unreadCounts.data?.unreadNotifications ?? 0) +
    (unreadCounts.data?.waitingForYouTickets ?? 0);
  const planTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim() || "—";
  const preferences = usePosStore((s) => s.preferences);
  const [query, setQuery] = useState("");

  if (searchParams.get("onboard") === "1") {
    return <Navigate to="/settings/shop?onboard=1" replace />;
  }

  if (!actorHasPermission(actor, "settings.view")) {
    return <Navigate to="/" replace />;
  }

  const canCap = (id: SettingsCapabilityId) => canAccessSettingsCapability(actor, id, snapshot, authMode);
  const canShopProfile = canCap("shop_profile");
  const canStaff = canCap("staff");
  const canDrawerSettings = canCap("cash_drawer");
  const canOwnerFinanceDiagnostics =
    canSeeFinanceDiagnostics(authOperatorRole(actor)) && canCap("finance_diagnostics");
  const canArrangeShelves = actorHasPermission(actor, "shelves.customize");
  const canReceipt = canCap("receipt");
  const canDevices = canCap("devices");
  const canSelling = canCap("selling");
  const canPin = canCap("pin");
  const canPassword = canCap("password");
  const canBiometric = canCap("biometric");
  const canHomeMenu = canCap("home_menu");
  const canOfficeMenu = canCap("office_menu");
  const canShelves = canCap("shelves") && canArrangeShelves;
  const canHealth = canCap("health");
  const canDiagnostics = canCap("diagnostics");
  const canRetention = canCap("retention");
  const pilotActive = isPilotModeActive(authOperatorRole(actor), preferences);
  const showFloorSetup = canCap("floor") && isHospitalityMode(businessType, hospitalityModeEnabled);
  const showPharmacySettings = canCap("pharmacy") && isPharmacyMode(businessType, pharmacyModeEnabled);
  const showHospitalitySettings = canCap("hospitality") && isHospitalityMode(businessType, hospitalityModeEnabled);

  // Same computed subtitle canonical rendered inline for /office/vision — just
  // hoisted so it can be placed in the grouped nav.
  const visionSubtitle =
    visionAccess.status === "included" || visionAccess.status === "local_bypass"
      ? [
          visionAccess.status === "local_bypass"
            ? t(lang, "visionLicLocalBypass")
            : `${t(lang, "visionLicIncludedWith")} ${visionAccess.planLabel}`,
          visionAccess.maxCameras == null
            ? t(lang, "visionLicUnlimitedCams")
            : `${visionAccess.maxCameras} ${t(lang, "visionLicCameras")}`,
          visionAccess.maxDvrs == null
            ? t(lang, "visionLicUnlimitedDvrs")
            : `${visionAccess.maxDvrs} ${t(lang, "visionLicDvrs")}`,
        ].join(" · ")
      : visionAccess.status === "trial"
        ? `${t(lang, "visionLicIncludedTrial")} · ${visionAccess.trialDaysRemaining ?? "—"} ${t(lang, "visionLicDaysLeft")}`
        : visionAccess.status === "subscription_expired"
          ? t(lang, "visionLicSubExpired")
          : t(lang, "visionLicNotActivated");

  const groups: SettingsNavGroup[] = [
    {
      id: "business",
      title: t(lang, "settingsHubGroupBusiness"),
      items: [
        { to: "/settings/shop", title: t(lang, "settingsHubShop"), subtitle: t(lang, "settingsHubShopSub"), Icon: Store, show: canShopProfile },
        { to: "/settings/pharmacy", title: t(lang, "settingsHubPharmacy"), subtitle: t(lang, "settingsHubPharmacySub"), Icon: Pill, show: showPharmacySettings },
        { to: "/settings/hospitality", title: t(lang, "hospitalitySettingsTitle"), subtitle: t(lang, "hospitalitySettingsSub"), Icon: UtensilsCrossed, show: showHospitalitySettings },
        { to: "/settings/floor", title: t(lang, "floorSetupTitle"), subtitle: t(lang, "floorSetupSub"), Icon: LayoutGrid, show: showFloorSetup },
      ],
    },
    {
      id: "pos",
      title: t(lang, "settingsHubGroupPos"),
      items: [
        { to: "/settings/selling", title: t(lang, "settingsHubSelling"), subtitle: t(lang, "settingsHubSellingSub"), Icon: Sliders, show: canSelling },
        { to: "/settings/receipt", title: t(lang, "settingsHubReceipt"), subtitle: t(lang, "settingsHubReceiptSub"), Icon: ReceiptText, show: canReceipt },
        { to: "/settings/cash-drawer", title: t(lang, "cashManageDrawerSettings"), subtitle: t(lang, "cashManageDrawerSettingsSub"), Icon: Banknote, show: canDrawerSettings },
      ],
    },
    {
      id: "inventory",
      title: t(lang, "settingsHubGroupInventory"),
      items: [
        { to: "/settings/shelves", title: t(lang, "settingsHubShelves"), subtitle: t(lang, "settingsHubShelvesSub"), Icon: LayoutGrid, show: canShelves },
      ],
    },
    {
      id: "staff",
      title: t(lang, "settingsHubGroupStaffAccess"),
      items: [
        { to: "/staff-center", title: t(lang, "officeCardStaffAccess"), subtitle: t(lang, "officeCardStaffAccessSub"), Icon: UserCog, show: canStaff },
        { to: "/settings/pin", title: t(lang, "settingsHubPin"), subtitle: t(lang, "settingsHubPinSub"), Icon: KeyRound, show: canPin },
        { to: "/settings/biometric", title: t(lang, "settingsHubBiometric"), subtitle: t(lang, "settingsHubBiometricSub"), Icon: Fingerprint, show: canBiometric },
        { to: "/settings/password", title: t(lang, "settingsHubPassword"), subtitle: t(lang, "settingsHubPasswordSub"), Icon: Lock, show: canPassword },
      ],
    },
    {
      id: "devices",
      title: t(lang, "settingsHubGroupDevices"),
      items: [
        { to: "/settings/devices", title: t(lang, "settingsHubDevices"), subtitle: t(lang, "settingsHubDevicesSub"), Icon: MonitorSmartphone, show: canDevices },
        // Hardware and Vision were always shown to any settings.view user in canonical.
        { to: "/office/hardware", title: t(lang, "officeCardHardware"), subtitle: t(lang, "officeCardHardwareSub"), Icon: Printer, show: true },
        { to: "/office/vision", title: t(lang, "officeCardVision"), subtitle: visionSubtitle, Icon: Camera, show: true },
      ],
    },
    {
      id: "app",
      title: t(lang, "settingsHubGroupAppearance"),
      items: [
        { to: "/settings/appearance", title: t(lang, "settingsHubAppearance"), subtitle: t(lang, "settingsHubAppearanceSub"), Icon: Palette, show: true },
        { to: "/settings/notifications", title: t(lang, "settingsHubNotifications"), subtitle: t(lang, "settingsHubNotificationsSub"), Icon: Bell, show: true },
        { to: "/settings/home-menu", title: t(lang, "settingsHubHomeMenu"), subtitle: t(lang, "settingsHubHomeMenuSub"), Icon: Home, show: canHomeMenu },
        { to: "/settings/office-menu", title: t(lang, "settingsHubOfficeMenu"), subtitle: t(lang, "settingsHubOfficeMenuSub"), Icon: Briefcase, show: canOfficeMenu },
      ],
    },
    {
      id: "system",
      title: t(lang, "settingsHubGroupSystemData"),
      items: [
        { to: "/settings/health", title: t(lang, "settingsHubSystemHealth"), subtitle: t(lang, "settingsHubSystemHealthSub"), Icon: Activity, show: canHealth },
        { to: "/settings/finance-diagnostics", title: t(lang, "settingsHubFinanceDiagnostics"), subtitle: t(lang, "settingsHubFinanceDiagnosticsSub"), Icon: Calculator, show: canOwnerFinanceDiagnostics },
        { to: "/settings/diagnostics", title: t(lang, "settingsHubDiagnostics"), subtitle: t(lang, "settingsHubDiagnosticsSub"), Icon: Stethoscope, show: canDiagnostics && Capacitor.isNativePlatform() },
        { to: "/settings/retention", title: t(lang, "settingsHubRetention"), subtitle: t(lang, "settingsHubRetentionSub"), Icon: Archive, show: canRetention },
      ],
    },
    {
      id: "support",
      title: t(lang, "supportCenterSupportSection"),
      items: [
        {
          to: "/support-center",
          title: t(lang, "supportCenterNavLabel"),
          subtitle: t(lang, "supportCenterSub"),
          Icon: LifeBuoy,
          show: true,
          highlight: supportAttentionTotal > 0,
          trailing: supportAttentionTotal > 0 ? String(supportAttentionTotal) : undefined,
        },
      ],
    },
  ];

  const needle = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.show &&
          (needle === "" ||
            item.title.toLowerCase().includes(needle) ||
            (item.subtitle ?? "").toLowerCase().includes(needle) ||
            group.title.toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <BackOfficePageLayout
      header={
        <EnterprisePageHeader
          lang={lang}
          title={t(lang, "settingsHubTitle")}
          subtitle={t(lang, "settingsHubSub")}
          backFallback="/"
          compact
        >
          <Body className="text-xs text-muted-foreground">
            {t(lang, "settingsYourPlanLabel")}: <MonoNumber as="span">{planTier}</MonoNumber>
            <span className="mx-2 text-muted-foreground" aria-hidden>
              ·
            </span>
            {t(lang, "settingsAppVersionLine")}: <MonoNumber as="span" className="font-mono">{appVersion}</MonoNumber>
          </Body>
        </EnterprisePageHeader>
      }
      className="pb-8"
    >
      {canShopProfile ? <ShopSupportNumberCard lang={lang} /> : null}
      <RemoteSupportStatusCard lang={lang} />

      <div className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(lang, "settingsHubSearchPlaceholder")}
            aria-label={t(lang, "settingsHubSearchPlaceholder")}
            className="min-h-[44px] w-full rounded-2xl border-2 border-border bg-card pl-10 pr-3 text-sm font-semibold outline-none focus:border-waka-500"
          />
        </div>

        {visibleGroups.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
            {tTemplate(lang, "settingsHubSearchNoMatch", { query })}
          </p>
        ) : (
          visibleGroups.map((group) => (
            <OfficeNavSection key={group.id} title={group.title}>
              {group.items.map((item) => (
                <OfficeNavCard
                  key={item.to}
                  to={item.to}
                  title={item.title}
                  subtitle={item.subtitle}
                  Icon={item.Icon}
                  highlight={item.highlight}
                  trailing={item.trailing}
                />
              ))}
            </OfficeNavSection>
          ))
        )}
      </div>

      {canTogglePilotMode(authOperatorRole(actor)) ? <PilotModeToggle lang={lang} /> : null}
      {canTogglePilotMode(authOperatorRole(actor)) ? (
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
