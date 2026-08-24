import { actorHasPermission } from "../../lib/actorAuthorization";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown, CircleHelp } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Language, UserRole } from "../../types";
import { t } from "../../lib/i18n";
import { languageToggleLabel, nextLanguage } from "../../lib/language";
import { useSubscription } from "../../context/SubscriptionContext";
import { useShopPresenceHeartbeat } from "../../hooks/useShopPresenceHeartbeat";
import { AppShellSyncLabel } from "./AppShellSyncLabel";
import { useAndroidBackButton } from "../../hooks/useAndroidBackButton";
import { useAndroidBackHandler } from "../../hooks/useAndroidBackHandler";
import { useLogoutAction } from "../../hooks/useLogoutAction";
import { ANDROID_BACK_PRIORITY } from "../../lib/androidBackStack";
import { useShallow } from "zustand/react/shallow";
import { usePosStore } from "../../store/usePosStore";
import type { ShopPreferences } from "../../types";
import { resolveSessionActor, authOperatorPermissions, authOperatorRole } from "../../lib/sessionActor";
import { resolveTerminalIdentityView } from "../../lib/terminalIdentity";
import { SessionActorProvider } from "../../context/SessionActorContext";
import { SessionHydrationProvider } from "../../context/SessionHydrationContext";

import { fetchWakaInternalAdminMe } from "../../lib/wakaInternalAdmin";
import { WakaSymbolIcon } from "../brand/WakaLogo";
import { isBackOfficePath, isSettingsLauncherPath } from "../../lib/backOfficePaths";
import { isHospitalityMode } from "../../lib/hospitality";
import { isPharmacyMode } from "../../lib/pharmacy";
import { isWholesaleMode } from "../../lib/wholesale";
import { isInternalAdminAppPath } from "../../lib/internalAdminPreview";
import { BackOfficeRouteGuard } from "./BackOfficeRouteGuard";
import { RouteErrorBoundary } from "../RouteErrorBoundary";
import { PilotModeBanner } from "../pilot/PilotModeBanner";
import { isPilotModeActive } from "../../lib/pilotMode";
import { MobileScrollTail } from "./MobileScrollTail";
import { AppModalOverlay } from "./AppModalOverlay";
import { resolveEffectivePlanTier } from "../../lib/subscriptionEntitlements";
import { fetchShopMemberRoleForUser } from "../../lib/shopMemberRole";
import { readCachedShopMemberRole, writeCachedShopMemberRole } from "../../lib/shopMemberRoleCache";
import {
  activeStaffCanUnlock,
  canLockPos,
  isBackOfficePinConfigured,
  isSharedTerminalLockOperator,
  shouldShowEnterpriseStaffLockScreen,
} from "../../lib/lockPos";
import { DisplayScaleControl } from "../pos/DisplayScaleControl";
import { EnterpriseStaffLockScreen } from "../auth/EnterpriseStaffLockScreen";
import {
  completePosUnlock,
  emergencyStaffLogout,
  lockPos,
  prepareSwitchUserLock,
  verifyLockScreenPin,
} from "../../lib/auth";
import { getUnlockLockoutStatus, unlockLimiterScope } from "../../lib/auth/staffLoginLimiter";
import { useStaffAutoLock, useStaffSessionBootstrap } from "../../hooks/useStaffAutoLock";
import { clearPersonalStaffTerminalRuntimeState } from "../../lib/staffAuthHydrate";
import { HeaderExitButton } from "./DesktopTerminalBackBar";
import { HeaderBackButton } from "./HeaderBackButton";
import { MobileModuleExitBar } from "./MobileModuleExitBar";
import { HospitalityMobileNav } from "../hospitality/HospitalityMobileNav";
import { PharmacyMobileNav } from "../pharmacy/PharmacyMobileNav";
import { PharmacyDesktopNav } from "../pharmacy/PharmacyDesktopNav";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { usePosLayoutMode } from "../../hooks/usePosLayoutMode";
import { shouldShowHeaderExit, isIndependentModuleRoute } from "../../lib/headerExit";
import { resolveEnterpriseBottomChrome } from "../../lib/enterpriseBottomChrome";
import { isViewportLockedRoute } from "../../lib/viewportLock";
import { isPharmacyOperationalRoute } from "../../lib/pharmacyNav";
import { resolveTerminalHomePath } from "../../lib/terminalHome";
import { isPosSellPath } from "../../lib/posSellExit";
import { AppThemeToggle } from "../ui/AppThemeToggle";
import { EnterpriseScrollControls } from "../enterprise/EnterpriseScrollControls";
import { useShopSecurityPinRecovery } from "../../hooks/useShopSecurityPinRecovery";
import { ShopSecurityPinRecoveryBanner } from "../security/ShopSecurityPinRecoveryBanner";
import {
  StaffCredentialRecoveryBanner,
  useStaffCredentialRecoveryOwnerNotice,
} from "../security/StaffCredentialRecoveryBanner";
import { PwaUpdateBanner } from "../app-update/AppUpdateControls";
import { RemoteSupportHost } from "../remote-support/RemoteSupportHost";
import { PosNeedHelpHost } from "../support/PosNeedHelpHost";
import { canSeePosNeedHelp, openPosNeedHelpForm } from "../../lib/posSupportRequest";
import { useRemoteSupportPlatformEnabled } from "../../hooks/useRemoteSupportPlatformEnabled";

const BackOfficeMasterSearch = lazy(() =>
  import("../office/BackOfficeMasterSearch").then((m) => ({ default: m.BackOfficeMasterSearch })),
);

type Props = {
  lang: Language;
  setLang: (lang: Language) => void;
  onSignOut: () => Promise<void>;
  user: User | null;
  email: string | null | undefined;
  authMode: "supabase" | "local";
  staffSession?: {
    staffId: string;
    staffName: string;
    role: UserRole;
  } | null;
};

export function AppShell({ lang, setLang, onSignOut, user, email, authMode, staffSession = null }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, loggingOut } = useLogoutAction(onSignOut);
  useAndroidBackButton();
  useShopPresenceHeartbeat();
  const hasPathSStaffSession = Boolean(staffSession);
  const preferences = usePosStore(
    useShallow((s) => ({
      devRoleOverride: s.preferences.devRoleOverride,
      activeStaffId: s.preferences.activeStaffId,
      staffAccounts: s.preferences.staffAccounts,
      posLocked: s.preferences.posLocked,
      backOfficePin: s.preferences.backOfficePin,
      businessType: s.preferences.businessType,
      hospitalityModeEnabled: s.preferences.hospitalityModeEnabled,
      hospitalityKitchenEnabled: s.preferences.hospitalityKitchenEnabled,
      pharmacyModeEnabled: s.preferences.pharmacyModeEnabled,
      pilotModeEnabled: s.preferences.pilotModeEnabled,
      shopDisplayName: s.preferences.shopDisplayName,
    })),
  );
  const { snapshot } = useSubscription();
  const shopId = snapshot.kind === "remote" ? snapshot.row.shop_id : null;
  const { noticeAt: shopSecurityPinRecoveryNotice, dismissNotice: dismissShopSecurityPinRecoveryNotice } =
    useShopSecurityPinRecovery(shopId);
  const { noticeAt: staffCredentialRecoveryNotice, dismissNotice: dismissStaffCredentialRecoveryNotice } =
    useStaffCredentialRecoveryOwnerNotice(shopId);
  const setPosLocked = usePosStore((s) => s.setPosLocked);
  const [menuOpen, setMenuOpen] = useState(false);
  const { enabled: remoteSupportEnabled } = useRemoteSupportPlatformEnabled();
  useAndroidBackHandler("app-menu-drawer", ANDROID_BACK_PRIORITY.menuDrawer, menuOpen, () => setMenuOpen(false));
  const [lockSetupHint, setLockSetupHint] = useState<string | null>(null);
  const [isInternalAdmin, setIsInternalAdmin] = useState(false);
  const [shopMemberRole, setShopMemberRole] = useState<UserRole | null>(() => {
    if (authMode !== "supabase" || !user?.id) return null;
    return readCachedShopMemberRole(user.id);
  });
  const [roleReady, setRoleReady] = useState(() => {
    if (authMode !== "supabase" || !user?.id) return true;
    return readCachedShopMemberRole(user.id) != null;
  });
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await fetchWakaInternalAdminMe();
      if (cancelled) return;
      setIsInternalAdmin(Boolean(row));
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (authMode !== "supabase" || !user?.id) {
      setShopMemberRole(null);
      setRoleReady(true);
      return;
    }
    const cached = readCachedShopMemberRole(user.id);
    if (cached) {
      setShopMemberRole(cached);
      setRoleReady(true);
    } else {
      setRoleReady(false);
    }
    let cancelled = false;
    void fetchShopMemberRoleForUser(user.id).then((role) => {
      if (cancelled) return;
      if (role) writeCachedShopMemberRole(user.id, role);
      setShopMemberRole(role);
      setRoleReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authMode, user?.id]);

  const actor = useMemo(
    () =>
      resolveSessionActor({
        mode: authMode,
        user,
        email,
        preferences: preferences as ShopPreferences,
        staffSession,
        shopMemberRole,
      }),
    [authMode, user, email, preferences, staffSession, shopMemberRole],
  );
  const sharedTerminalLockOperator = isSharedTerminalLockOperator({
    authOperatorRole: authOperatorRole(actor),
    hasPathSStaffSession,
  });
  useStaffAutoLock(sharedTerminalLockOperator);
  useStaffSessionBootstrap(sharedTerminalLockOperator);

  useEffect(() => {
    // Wait for membership before treating fail-closed waiter as Path L personal staff.
    if (authMode === "supabase" && !roleReady) return;
    if (sharedTerminalLockOperator) return;
    clearPersonalStaffTerminalRuntimeState();
  }, [
    authMode,
    roleReady,
    sharedTerminalLockOperator,
    preferences.posLocked,
    preferences.activeStaffId,
  ]);

  const pilotActive = isPilotModeActive(authOperatorRole(actor), preferences as ShopPreferences);
  const tier = resolveEffectivePlanTier(snapshot);
  const canSwitchUser = tier === "business" || tier === "waka_plus";

  useLayoutEffect(() => {
    usePosStore.getState().setSessionActor(actor);
  }, [actor]);

  const jwtOperatorName = useMemo(() => {
    const meta = user?.user_metadata as Record<string, string> | undefined;
    return meta?.full_name?.trim() || user?.email?.trim() || email?.trim() || null;
  }, [user, email]);

  const terminalIdentity = useMemo(
    () => resolveTerminalIdentityView(actor, preferences as ShopPreferences, jwtOperatorName),
    [actor, preferences, jwtOperatorName],
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (userMenuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!preferences.posLocked && !canLockPos(preferences)) return;
    void import("../../lib/shopRecoverySignals").then(({ ensureShopRecoveryApplied }) => {
      void ensureShopRecoveryApplied();
    });
  }, [preferences.posLocked, preferences.backOfficePin]);

  useEffect(() => {
    if (!preferences.posLocked) return;
    if (canLockPos(preferences)) return;
    if (activeStaffCanUnlock(preferences.staffAccounts)) return;
    setPosLocked(false);
  }, [preferences.posLocked, preferences.backOfficePin, preferences.staffAccounts, setPosLocked]);

  const requestPosLock = () => {
    if (!sharedTerminalLockOperator) return;
    setLockSetupHint(null);
    if (!canLockPos(preferences)) {
      if (actorHasPermission(actor, "settings.shop")) {
        navigate("/settings/pin", { state: { setupLockPin: true, notice: t(lang, "lockPosNeedPinFirst") } });
      } else {
        setLockSetupHint(t(lang, "lockPosAskOwnerPin"));
      }
      return;
    }
    lockPos("manual");
  };

  const internalAdminRoute = isInternalAdminAppPath(location.pathname);
  const isDesktopLayout = usePosDesktopLayout();
  const posLayoutMode = usePosLayoutMode();
  const hospitalityNav = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyNav = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const wholesaleNav = isWholesaleMode(preferences.businessType);
  const terminalHome = resolveTerminalHomePath(
    preferences,
    authOperatorRole(actor),
    authOperatorPermissions(actor) ?? actor.permissions,
  );
  const onTerminalHome = location.pathname === terminalHome;
  const isLauncherHome = location.pathname === "/";
  const desktopTerminalHome = isDesktopLayout && isLauncherHome;
  const onSellScreen = isPosSellPath(location.pathname);
  const phoneChrome = !isDesktopLayout;
  const sellMobileChrome = onSellScreen && phoneChrome;
  /** Home keeps the full toolbar; every other phone screen folds extras into one menu. */
  const headerToolsCollapsed = phoneChrome && !isLauncherHome;
  const fullDesktopSell = onSellScreen && posLayoutMode === "full";
  const independentModule = isIndependentModuleRoute(location.pathname);
  /** lg+ terminal layout: full-width chrome outside the classic back-office column. */
  const desktopTerminalMode = isDesktopLayout && !internalAdminRoute;
  const fullWidthChrome = desktopTerminalMode || desktopTerminalHome || independentModule;
  const showHeaderExit =
    shouldShowHeaderExit(location.pathname) || (onSellScreen && !isDesktopLayout);
  const showBackOfficeSearch =
    isBackOfficePath(location.pathname) &&
    location.pathname !== "/office" &&
    !isSettingsLauncherPath(location.pathname) &&
    !internalAdminRoute;

  const sellNavLabelKey = hospitalityNav ? "navSell" : pharmacyNav ? "navDispense" : wholesaleNav ? "navInvoiceDesk" : "navSell";

  const bottomChrome = useMemo(
    () =>
      resolveEnterpriseBottomChrome({
        pathname: location.pathname,
        terminalHome,
        isDesktopLayout,
        pharmacyWorkspace: pharmacyNav && !hospitalityNav,
        hospitalityBusiness: hospitalityNav,
      }),
    [location.pathname, terminalHome, isDesktopLayout, pharmacyNav, hospitalityNav],
  );

  const viewportLocked = isViewportLockedRoute(location.pathname) || fullDesktopSell;

  const showHospitalityMobileNav =
    bottomChrome.mode === "hospitality" && bottomChrome.showMobileBar && !internalAdminRoute;
  const showPharmacyMobileNav =
    bottomChrome.mode === "pharmacy" && bottomChrome.showMobileBar && !onSellScreen;
  const showPharmacyDesktopNav =
    pharmacyNav &&
    !hospitalityNav &&
    isPharmacyOperationalRoute(location.pathname) &&
    !internalAdminRoute &&
    isDesktopLayout &&
    !isLauncherHome &&
    !onSellScreen;
  const showMobileModuleExit =
    bottomChrome.mode === "module-exit" && bottomChrome.showMobileBar && !internalAdminRoute;
  const showHeaderExitButton = showHeaderExit && (!showMobileModuleExit || isDesktopLayout) && !onTerminalHome;
  const showPosHelp = canSeePosNeedHelp({
    authenticated: Boolean(user) || authMode === "local",
    internalAdminRoute,
    posLocked: Boolean(preferences.posLocked),
    remoteSupportEnabled,
  });

  return (
    <SessionHydrationProvider roleReady={roleReady}>
    <SessionActorProvider value={actor}>
      <div
        className={clsx(
          "app-shell-root flex h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden text-foreground transition-colors duration-300",
          isLauncherHome ? "bg-gradient-to-b from-waka-500 via-waka-50 to-card" : "bg-muted",
          onSellScreen && "app-shell--sell-focus",
          fullDesktopSell && "app-shell--pos-enterprise",
          isLauncherHome && "app-shell--launcher",
          showMobileModuleExit && "app-shell--module-exit",
          bottomChrome.shellClass,
        )}
      >
        <PwaUpdateBanner lang={lang} />
        <RemoteSupportHost lang={lang} />
        {fullDesktopSell ? (
          <PosNeedHelpHost
            lang={lang}
            shopId={shopId}
            role={actor.role}
            authenticated={Boolean(user) || authMode === "local"}
            internalAdminRoute={internalAdminRoute}
            posLocked={Boolean(preferences.posLocked)}
            placement="floating"
            inverted={isLauncherHome}
          />
        ) : null}
        {shopSecurityPinRecoveryNotice &&
        authOperatorRole(actor) === "owner" &&
        !isBackOfficePinConfigured(preferences.backOfficePin) &&
        !internalAdminRoute ? (
          <ShopSecurityPinRecoveryBanner lang={lang} onDismiss={dismissShopSecurityPinRecoveryNotice} />
        ) : null}
        {staffCredentialRecoveryNotice && authOperatorRole(actor) === "owner" && !internalAdminRoute ? (
          <StaffCredentialRecoveryBanner lang={lang} onDismiss={dismissStaffCredentialRecoveryNotice} />
        ) : null}
        {pilotActive ? <PilotModeBanner lang={lang} /> : null}
        {!fullDesktopSell ? (
        <header
          className={clsx(
            "relative z-20 shrink-0 overflow-visible border-b shadow-sm backdrop-blur",
            phoneChrome && "app-shell-mobile-header",
            isLauncherHome
              ? "border-waka-700/30 bg-waka-600/95 text-white supports-[backdrop-filter]:bg-waka-600/90"
              : sellMobileChrome
                ? "border-border/80 bg-gradient-to-b from-waka-50/90 via-card to-card supports-[backdrop-filter]:from-waka-50/80"
                : "border-border/90 bg-card/95 supports-[backdrop-filter]:bg-card/90",
          )}
        >
          <div
            className={clsx(
              "app-shell-header-bar mx-auto flex items-center justify-between",
              phoneChrome
                ? "max-w-none flex-nowrap gap-1 px-2 pb-0.5 pt-0.5"
                : "flex-wrap gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-4",
              desktopTerminalMode || desktopTerminalHome || independentModule || isLauncherHome ? "max-w-none lg:px-8 xl:px-10" : !onSellScreen || isDesktopLayout ? "max-w-6xl" : "",
            )}
          >
            <div className={clsx("flex min-w-0 flex-1 items-center", phoneChrome ? "gap-1" : "gap-1.5 sm:gap-2")}>
              {showHeaderExitButton ? (
                <HeaderExitButton
                  lang={lang}
                  variant={sellMobileChrome ? "sellOrange" : "default"}
                  className={phoneChrome ? "!min-h-8 gap-1 px-2.5 py-1" : undefined}
                />
              ) : null}
              {showHeaderExit ? <HeaderBackButton lang={lang} /> : null}
              {sellMobileChrome ? null : <WakaSymbolIcon size="xs" className={clsx("shrink-0", phoneChrome ? "h-7 w-7" : "h-8 w-8")} />}
              <div className="min-w-0">
                {sellMobileChrome ? (
                  <h1 className="truncate text-sm font-black tracking-tight text-foreground">
                    {t(lang, sellNavLabelKey)}
                  </h1>
                ) : (
                  <AppShellSyncLabel lang={lang} inverted={isLauncherHome} />
                )}
              </div>
            </div>
            <div className={clsx("flex shrink-0 items-center justify-end", phoneChrome ? "gap-1" : "gap-1.5")}>
              {!headerToolsCollapsed && onSellScreen ? (
                <DisplayScaleControl lang={lang} inverted={isLauncherHome} compact={phoneChrome} />
              ) : null}
              <PosNeedHelpHost
                lang={lang}
                shopId={shopId}
                role={actor.role}
                authenticated={Boolean(user) || authMode === "local"}
                internalAdminRoute={internalAdminRoute}
                posLocked={Boolean(preferences.posLocked)}
                placement={headerToolsCollapsed ? "event-only" : "inline"}
                inverted={isLauncherHome}
                iconOnly={false}
              />
              {headerToolsCollapsed ? null : (
                <AppThemeToggle
                  lang={lang}
                  inverted={isLauncherHome}
                  className={phoneChrome ? "!h-8 !w-8" : undefined}
                />
              )}
              <div ref={userMenuRef} className="relative min-w-0">
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((v) => !v)}
                  className={clsx(
                    "flex touch-manipulation items-center truncate rounded-xl border font-bold shadow-sm",
                    phoneChrome
                      ? "min-h-8 max-w-[7.5rem] gap-0.5 px-2 py-1 text-[11px]"
                      : "min-h-[38px] max-w-[12rem] gap-1.5 px-3 py-1.5 text-xs sm:max-w-[14rem]",
                    isLauncherHome
                      ? "border-waka-400/50 bg-waka-700/50 text-white active:bg-waka-700"
                      : "border-border bg-card text-foreground active:bg-muted",
                  )}
                >
                  <span className="truncate">{actor.displayName ?? actor.role}</span>
                  <ChevronDown
                    className={clsx(
                      "h-3.5 w-3.5 shrink-0 transition-transform",
                      isLauncherHome ? "text-waka-100" : "text-muted-foreground",
                      menuOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className={clsx(
                      "absolute right-0 top-[calc(100%+0.35rem)] z-50 origin-top-right rounded-xl border border-border bg-card py-1 shadow-lg ring-1 ring-foreground/5",
                      headerToolsCollapsed ? "w-64" : "w-52",
                    )}
                  >
                    {headerToolsCollapsed && onSellScreen ? (
                      <div className="px-2 pb-2 pt-1" onClick={(e) => e.stopPropagation()}>
                        <p className="mb-1 px-1 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                          {t(lang, "displayScaleControlLabel")}
                        </p>
                        <DisplayScaleControl lang={lang} compact={false} />
                      </div>
                    ) : null}
                    {headerToolsCollapsed && showPosHelp ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
                        onClick={() => {
                          setMenuOpen(false);
                          openPosNeedHelpForm();
                        }}
                      >
                        <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
                        {t(lang, "posHelpButton")}
                      </button>
                    ) : null}
                    {headerToolsCollapsed ? (
                      <>
                        <div className="px-2 py-1">
                          <AppThemeToggle lang={lang} variant="inline" className="w-full justify-start shadow-none" />
                        </div>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
                          onClick={() => setLang(nextLanguage(lang))}
                        >
                          {languageToggleLabel(lang)}
                        </button>
                        <div className="my-1 border-t border-border" />
                      </>
                    ) : null}
                    {sharedTerminalLockOperator ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canSwitchUser}
                          title={canSwitchUser ? undefined : t(lang, "userMenuComingSoon")}
                          className={clsx(
                            "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold",
                            canSwitchUser
                              ? "text-foreground hover:bg-muted"
                              : "cursor-not-allowed text-muted-foreground",
                          )}
                          onClick={() => {
                            if (!canSwitchUser) return;
                            requestPosLock();
                            setMenuOpen(false);
                          }}
                        >
                          {t(lang, "userMenuSwitchUser")}
                          {!canSwitchUser ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              {t(lang, "userMenuComingSoon")}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
                          onClick={() => {
                            requestPosLock();
                            setMenuOpen(false);
                          }}
                        >
                          {t(lang, "userMenuLockTerminal")}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/office/account", { preventScrollReset: true });
                      }}
                    >
                      {t(lang, "userMenuProfile")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/settings/appearance", { preventScrollReset: true });
                      }}
                    >
                      {t(lang, "settingsHubAppearance")}
                    </button>
                    {authMode === "supabase" && !staffSession && authOperatorRole(actor) === "owner" ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
                        onClick={() => {
                          setMenuOpen(false);
                          navigate("/office/account/delete", { preventScrollReset: true });
                        }}
                      >
                        {t(lang, "userMenuDeleteAccount")}
                      </button>
                    ) : null}
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      role="menuitem"
                      disabled={loggingOut}
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="mx-2 mb-1 block w-[calc(100%-1rem)] rounded-lg bg-foreground px-3 py-2.5 text-center text-sm font-semibold text-background hover:bg-foreground disabled:opacity-60"
                    >
                      {t(lang, "userMenuLogout")}
                    </button>
                  </div>
                ) : null}
              </div>
              {headerToolsCollapsed ? null : (
              <button
                type="button"
                onClick={() => setLang(nextLanguage(lang))}
                className={clsx(
                  "truncate rounded-xl border font-bold shadow-sm",
                  phoneChrome
                    ? "min-h-8 max-w-[6.5rem] px-2 py-1 text-[11px]"
                    : "min-h-[38px] max-w-[7.5rem] px-3 py-1.5 text-xs",
                  isLauncherHome
                    ? "border-waka-400/50 bg-waka-700/50 text-white active:bg-waka-700"
                    : "border-border bg-card text-foreground active:bg-muted",
                )}
                aria-label={t(lang, "langEnglish")}
              >
                {languageToggleLabel(lang)}
              </button>
              )}
            </div>
          </div>
        </header>
        ) : null}
        {showBackOfficeSearch ? (
          <div
            className={clsx(
              "relative z-10 shrink-0 border-b border-border/80 bg-card/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/90 sm:px-4",
              desktopTerminalMode || desktopTerminalHome || independentModule || isLauncherHome ? "lg:px-8 xl:px-10" : "",
            )}
          >
            <div className={clsx("mx-auto w-full", fullWidthChrome ? "max-w-none" : "max-w-6xl")}>
              <Suspense fallback={null}>
                <BackOfficeMasterSearch lang={lang} className="max-w-3xl" />
              </Suspense>
            </div>
          </div>
        ) : null}
        <PharmacyDesktopNav lang={lang} visible={showPharmacyDesktopNav} />
        <main
          className={clsx(
            "mx-auto box-border flex min-h-0 w-full flex-1 gap-4 overflow-hidden",
            isLauncherHome ? "px-0 py-0" : onSellScreen ? "px-0 py-0 sm:px-1" : "px-3 py-3 sm:px-4 md:px-6",
            fullWidthChrome || isLauncherHome ? "max-w-none" : "max-w-6xl",
            fullWidthChrome && !desktopTerminalHome && !isLauncherHome && (
              onSellScreen ? "lg:px-4 xl:px-6 2xl:px-8" : "lg:px-8 xl:px-10"
            ),
          )}
        >
          <section className={clsx("flex min-h-0 min-w-0 max-w-full flex-1 flex-col", independentModule ? "pb-0" : "md:pb-0")}>
            <div
              className={clsx(
                "scroll-main-chrome min-h-0 flex-1 overscroll-y-contain [-webkit-overflow-scrolling:touch]",
                viewportLocked ? "flex flex-col overflow-hidden" : "overflow-y-auto",
                "overflow-x-hidden min-w-0 max-w-full",
                onSellScreen ? "scroll-main-chrome--pos" : "",
              )}
            >
              <div
                className={clsx(
                  "min-h-0 min-w-0 max-w-full",
                  viewportLocked && "flex min-h-0 flex-1 flex-col overflow-hidden",
                )}
              >
                <BackOfficeRouteGuard lang={lang}>
                  <RouteErrorBoundary scope="page">
                    <Outlet />
                  </RouteErrorBoundary>
                </BackOfficeRouteGuard>
              </div>
              {!viewportLocked ? <MobileScrollTail /> : null}
            </div>
          </section>
        </main>
        {showMobileModuleExit ? <MobileModuleExitBar lang={lang} terminalHome={terminalHome} /> : null}
        <HospitalityMobileNav lang={lang} visible={showHospitalityMobileNav} />
        <PharmacyMobileNav lang={lang} visible={showPharmacyMobileNav} />
        <EnterpriseScrollControls enabled={!viewportLocked} />
        {shouldShowEnterpriseStaffLockScreen({
          posLocked: Boolean(preferences.posLocked),
          authOperatorRole: authOperatorRole(actor),
          hasPathSStaffSession,
          pathname: location.pathname,
          canManageShopSettings: actorHasPermission(actor, "settings.shop"),
        }) ? (
          <EnterpriseStaffLockScreen
            lang={lang}
            preferences={preferences as ShopPreferences}
            identity={terminalIdentity}
            businessName={preferences.shopDisplayName ?? ""}
            canSwitchUser={canSwitchUser}
            isInternalAdmin={isInternalAdmin}
            showSetupPin={
              !isBackOfficePinConfigured(preferences.backOfficePin) && actorHasPermission(actor, "settings.shop")
            }
            onSetupPin={() => {
              setPosLocked(false);
              navigate("/settings/pin", { state: { setupLockPin: true } });
            }}
            onUnlock={async ({ staffId, selectingOwner, secret }) => {
              const activeStaff = (preferences.staffAccounts ?? []).filter((s) => s.active);
              const verify = await verifyLockScreenPin({
                preferences: preferences as ShopPreferences,
                secret,
                targetStaffId: staffId,
                selectingOwner,
                activeStaff,
              });
              if (!verify.ok) {
                return { ok: false as const, errorKey: verify.errorKey };
              }
              const unlock = completePosUnlock(verify.staffId);
              if (!unlock.ok) {
                return { ok: false as const, errorKey: unlock.errorKey };
              }
              return { ok: true as const };
            }}
            onBiometricUnlock={async () => {
              const scopeKey = unlockLimiterScope(preferences.activeStaffId);
              const lockout = getUnlockLockoutStatus(scopeKey);
              if (lockout.locked) {
                return { ok: false as const, errorKey: "staffUnlockBruteForceLock" };
              }
              const unlock = completePosUnlock(preferences.activeStaffId ?? null);
              if (!unlock.ok) {
                return { ok: false as const, errorKey: unlock.errorKey };
              }
              return { ok: true as const };
            }}
            onSwitchUser={() => {
              prepareSwitchUserLock();
            }}
            onEmergencyLogout={() => {
              // Phase 11l: "Sign in with another account" — full terminal context clear → /login email.
              emergencyStaffLogout();
              logout();
            }}
          />
        ) : null}
        {lockSetupHint ? (
          <AppModalOverlay className="z-[115] flex items-center justify-center bg-overlay/70 p-4">
            <div className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
              <p className="text-lg font-black text-foreground">{t(lang, "lockPos")}</p>
              <p className="mt-2 text-sm font-medium text-muted-foreground">{lockSetupHint}</p>
              <button
                type="button"
                className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
                onClick={() => setLockSetupHint(null)}
              >
                {t(lang, "cancel")}
              </button>
            </div>
          </AppModalOverlay>
        ) : null}
      </div>
    </SessionActorProvider>
    </SessionHydrationProvider>
  );
}
