import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Language, UserRole } from "../../types";
import { t } from "../../lib/i18n";
import { languageToggleLabel, nextLanguage } from "../../lib/language";
import { useSubscription } from "../../context/SubscriptionContext";
import { useShopPresenceHeartbeat } from "../../hooks/useShopPresenceHeartbeat";
import { AppShellSyncLabel } from "./AppShellSyncLabel";
import { useAndroidBackButton } from "../../hooks/useAndroidBackButton";
import { useAndroidBackHandler } from "../../hooks/useAndroidBackHandler";
import { ANDROID_BACK_PRIORITY } from "../../lib/androidBackStack";
import { useShallow } from "zustand/react/shallow";
import { usePosStore } from "../../store/usePosStore";
import type { ShopPreferences } from "../../types";
import { resolveSessionActor } from "../../lib/sessionActor";
import { SessionActorProvider } from "../../context/SessionActorContext";
import { SessionHydrationProvider } from "../../context/SessionHydrationContext";
import { hasPermission } from "../../lib/permissions";
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
import { normalizePin } from "../../lib/staffSecret";
import { resolveEffectivePlanTier } from "../../lib/subscriptionEntitlements";
import { fetchShopMemberRoleForUser } from "../../lib/shopMemberRole";
import { activeStaffCanUnlock, canLockPos, isBackOfficePinConfigured } from "../../lib/lockPos";
import { PinInput } from "../ui/PinInput";
import { ShiftCloseModal } from "../pos/ShiftCloseModal";
import { DisplayScaleControl } from "../pos/DisplayScaleControl";
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
  useAndroidBackButton();
  useShopPresenceHeartbeat();
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
    })),
  );
  const { snapshot } = useSubscription();
  const setPosLocked = usePosStore((s) => s.setPosLocked);
  const switchStaffAccount = usePosStore((s) => s.switchStaffAccount);
  const closeShiftWithCashCount = usePosStore((s) => s.closeShiftWithCashCount);
  const shifts = usePosStore((s) => s.preferences.shifts);
  const [pwaUpdate, setPwaUpdate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useAndroidBackHandler("app-menu-drawer", ANDROID_BACK_PRIORITY.menuDrawer, menuOpen, () => setMenuOpen(false));
  const [lockStaffId, setLockStaffId] = useState(preferences.activeStaffId ?? "");
  const [lockSecret, setLockSecret] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockSetupHint, setLockSetupHint] = useState<string | null>(null);
  const [staffSwitchShiftOpen, setStaffSwitchShiftOpen] = useState(false);
  const [staffSwitchCloseOpen, setStaffSwitchCloseOpen] = useState(false);
  const [pendingStaffUnlock, setPendingStaffUnlock] = useState<{
    staffId: string | null;
    secret: string;
  } | null>(null);
  const [isInternalAdmin, setIsInternalAdmin] = useState(false);
  const [shopMemberRole, setShopMemberRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(() => authMode !== "supabase" || !user?.id);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onUp = () => setPwaUpdate(true);
    window.addEventListener("waka:pwa-update", onUp);
    return () => window.removeEventListener("waka:pwa-update", onUp);
  }, []);

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
    let cancelled = false;
    setRoleReady(false);
    void fetchShopMemberRoleForUser(user.id).then((role) => {
      if (!cancelled) {
        setShopMemberRole(role);
        setRoleReady(true);
      }
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
  const pilotActive = isPilotModeActive(actor.role, preferences as ShopPreferences);
  const tier = resolveEffectivePlanTier(snapshot);
  const canSwitchUser = tier === "business" || tier === "waka_plus";

  useLayoutEffect(() => {
    usePosStore.getState().setSessionActor(actor);
  }, [actor]);

  const activeShiftForActor = useMemo(
    () => (shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId) ?? null,
    [shifts, actor.userId],
  );

  const completeStaffUnlock = useCallback(
    (staffId: string | null) => {
      const r = switchStaffAccount(staffId);
      if (!r.ok) {
        setLockError(t(lang, r.errorKey ?? "saleError"));
        return;
      }
      setPosLocked(false);
      setLockSecret("");
      setLockError(null);
      setPendingStaffUnlock(null);
    },
    [lang, setPosLocked, switchStaffAccount],
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
    const activeStaff = (preferences.staffAccounts ?? []).filter((s) => s.active);
    setLockSecret("");
    setLockError(null);
    setLockStaffId((prev) => {
      if (prev) return prev;
      if (preferences.activeStaffId) return preferences.activeStaffId;
      if (canSwitchUser && activeStaff.length > 0) return "__owner__";
      return "";
    });
  }, [preferences.posLocked, preferences.staffAccounts, preferences.activeStaffId, canSwitchUser]);

  useEffect(() => {
    if (!preferences.posLocked) return;
    if (canLockPos(preferences)) return;
    if (activeStaffCanUnlock(preferences.staffAccounts)) return;
    setPosLocked(false);
  }, [preferences.posLocked, preferences.backOfficePin, preferences.staffAccounts, setPosLocked]);

  const requestPosLock = () => {
    setLockSetupHint(null);
    if (!canLockPos(preferences)) {
      if (hasPermission(actor.role, "settings.shop")) {
        navigate("/settings/pin", { state: { setupLockPin: true, notice: t(lang, "lockPosNeedPinFirst") } });
      } else {
        setLockSetupHint(t(lang, "lockPosAskOwnerPin"));
      }
      return;
    }
    setPosLocked(true);
  };

  const internalAdminRoute = isInternalAdminAppPath(location.pathname);
  const isDesktopLayout = usePosDesktopLayout();
  const posLayoutMode = usePosLayoutMode();
  const hospitalityNav = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyNav = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const wholesaleNav = isWholesaleMode(preferences.businessType);
  const terminalHome = resolveTerminalHomePath(preferences, actor.role);
  const onTerminalHome = location.pathname === terminalHome;
  const isLauncherHome = location.pathname === "/";
  const desktopTerminalHome = isDesktopLayout && isLauncherHome;
  const onSellScreen = isPosSellPath(location.pathname);
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

  return (
    <SessionHydrationProvider roleReady={roleReady}>
    <SessionActorProvider value={actor}>
      <div
        className={clsx(
          "app-shell-root flex h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden text-stone-900 transition-colors duration-300",
          isLauncherHome ? "bg-gradient-to-b from-waka-500 via-waka-50 to-white" : "bg-stone-50",
          onSellScreen && "app-shell--sell-focus",
          fullDesktopSell && "app-shell--pos-enterprise",
          isLauncherHome && "app-shell--launcher",
          showMobileModuleExit && "app-shell--module-exit",
          bottomChrome.shellClass,
        )}
      >
        {pwaUpdate ? (
          <div className="z-40 shrink-0 border-b border-waka-200 bg-waka-50 px-3 py-2 text-center shadow-sm">
            <p className="text-sm font-bold text-waka-950">{t(lang, "pwaUpdateTitle")}</p>
            <button
              type="button"
              className="mt-1 rounded-full bg-waka-600 px-4 py-1.5 text-xs font-black text-white"
              onClick={() => window.location.reload()}
            >
              {t(lang, "pwaUpdateCta")}
            </button>
          </div>
        ) : null}
        {pilotActive ? <PilotModeBanner lang={lang} /> : null}
        {!fullDesktopSell ? (
        <header
          className={clsx(
            "relative z-20 shrink-0 overflow-visible border-b shadow-sm backdrop-blur",
            isLauncherHome
              ? "border-waka-700/30 bg-waka-600/95 text-white supports-[backdrop-filter]:bg-waka-600/90"
              : onSellScreen && !isDesktopLayout
                ? "border-stone-200/80 bg-gradient-to-b from-waka-50/90 via-white to-white supports-[backdrop-filter]:from-waka-50/80"
                : "border-stone-200/90 bg-white/95 supports-[backdrop-filter]:bg-white/90",
          )}
        >
          <div
            className={clsx(
              "mx-auto flex flex-wrap items-center justify-between gap-2 sm:px-4",
              onSellScreen && !isDesktopLayout
                ? "max-w-none px-2 pb-1 pt-[max(0.25rem,env(safe-area-inset-top,0px))]"
                : "px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-4",
              desktopTerminalMode || desktopTerminalHome || independentModule || isLauncherHome ? "max-w-none lg:px-8 xl:px-10" : !onSellScreen || isDesktopLayout ? "max-w-6xl" : "",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              {showHeaderExitButton ? (
                <HeaderExitButton lang={lang} variant={onSellScreen && !isDesktopLayout ? "sellOrange" : "default"} />
              ) : null}
              {showHeaderExit ? <HeaderBackButton lang={lang} /> : null}
              {onSellScreen && !isDesktopLayout ? null : <WakaSymbolIcon size="xs" className="h-8 w-8 shrink-0" />}
              <div className="min-w-0">
                {onSellScreen && !isDesktopLayout ? (
                  <h1 className="truncate text-base font-black tracking-tight text-stone-950 sm:text-lg">
                    {t(lang, sellNavLabelKey)}
                  </h1>
                ) : (
                  <AppShellSyncLabel lang={lang} inverted={isLauncherHome} />
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              {onSellScreen ? (
                <DisplayScaleControl lang={lang} inverted={isLauncherHome} compact={!isDesktopLayout} />
              ) : null}
              <AppThemeToggle lang={lang} inverted={isLauncherHome} />
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((v) => !v)}
                  className={clsx(
                    "flex min-h-[38px] max-w-[12rem] touch-manipulation items-center gap-1.5 truncate rounded-xl border px-3 py-1.5 text-xs font-bold shadow-sm sm:max-w-[14rem]",
                    isLauncherHome
                      ? "border-waka-400/50 bg-waka-700/50 text-white active:bg-waka-700"
                      : "border-stone-200 bg-white text-stone-800 active:bg-stone-50",
                  )}
                >
                  <span className="truncate">{actor.displayName ?? actor.role}</span>
                  <ChevronDown
                    className={clsx(
                      "h-3.5 w-3.5 shrink-0 transition-transform",
                      isLauncherHome ? "text-waka-100" : "text-stone-500",
                      menuOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-52 origin-top-right rounded-xl border border-stone-200 bg-white py-1 shadow-lg ring-1 ring-stone-900/5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canSwitchUser}
                      title={canSwitchUser ? undefined : t(lang, "userMenuComingSoon")}
                      className={clsx(
                        "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold",
                        canSwitchUser
                          ? "text-stone-800 hover:bg-stone-50"
                          : "cursor-not-allowed text-stone-400",
                      )}
                      onClick={() => {
                        if (!canSwitchUser) return;
                        requestPosLock();
                        setMenuOpen(false);
                      }}
                    >
                      {t(lang, "userMenuSwitchUser")}
                      {!canSwitchUser ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
                          {t(lang, "userMenuComingSoon")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50"
                      onClick={() => {
                        requestPosLock();
                        setMenuOpen(false);
                      }}
                    >
                      {t(lang, "userMenuLockTerminal")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50"
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
                      className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/settings/appearance", { preventScrollReset: true });
                      }}
                    >
                      {t(lang, "settingsHubAppearance")}
                    </button>
                    {authMode === "supabase" && !staffSession && actor.role === "owner" ? (
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
                    <div className="my-1 border-t border-stone-100" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void onSignOut();
                      }}
                      className="mx-2 mb-1 block w-[calc(100%-1rem)] rounded-lg bg-stone-900 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-stone-800"
                    >
                      {t(lang, "userMenuLogout")}
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setLang(nextLanguage(lang))}
                className={clsx(
                  "min-h-[38px] max-w-[7.5rem] truncate rounded-xl border px-3 py-1.5 text-xs font-bold shadow-sm",
                  isLauncherHome
                    ? "border-waka-400/50 bg-waka-700/50 text-white active:bg-waka-700"
                    : "border-stone-200 bg-white text-stone-800 active:bg-stone-50",
                )}
                aria-label={t(lang, "langEnglish")}
              >
                {languageToggleLabel(lang)}
              </button>
            </div>
          </div>
        </header>
        ) : null}
        {showBackOfficeSearch ? (
          <div
            className={clsx(
              "relative z-10 shrink-0 border-b border-stone-200/80 bg-white/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:px-4",
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
        <PharmacyDesktopNav lang={lang} role={actor.role} visible={showPharmacyDesktopNav} />
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
                viewportLocked ? "overflow-hidden" : "overflow-y-auto",
                "overflow-x-hidden min-w-0 max-w-full",
                onSellScreen ? "scroll-main-chrome--pos" : "",
              )}
            >
              <BackOfficeRouteGuard lang={lang}>
                <RouteErrorBoundary scope="page">
                  <Outlet />
                </RouteErrorBoundary>
              </BackOfficeRouteGuard>
              <MobileScrollTail />
            </div>
          </section>
        </main>
        {showMobileModuleExit ? <MobileModuleExitBar lang={lang} terminalHome={terminalHome} /> : null}
        <HospitalityMobileNav lang={lang} role={actor.role} visible={showHospitalityMobileNav} />
        <PharmacyMobileNav lang={lang} role={actor.role} visible={showPharmacyMobileNav} />
        {preferences.posLocked ? (
          <AppModalOverlay className="z-[120] flex items-center justify-center bg-stone-950/85 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <p className="text-2xl font-black text-stone-900">{t(lang, "lockPosTitle")}</p>
              <p className="mt-1 text-sm text-stone-600">{t(lang, "lockPosSub")}</p>
              {canSwitchUser && (preferences.staffAccounts ?? []).length > 0 ? (
                <label className="mt-4 block text-sm font-bold text-stone-700">
                  {t(lang, "switchUser")}
                  <select
                    value={lockStaffId}
                    onChange={(e) => {
                      setLockStaffId(e.target.value);
                      setLockError(null);
                    }}
                    className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3"
                  >
                    <option value="">{t(lang, "staffPickAccount")}</option>
                    <option value="__owner__">{t(lang, "role_owner")}</option>
                    {(preferences.staffAccounts ?? [])
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({t(lang, `role_${s.role}`)})
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <p className="mt-2 text-xs font-medium text-stone-500">{t(lang, "lockScreenStaffHint")}</p>
              <PinInput
                value={lockSecret}
                onChange={(e) => {
                  setLockSecret(e.target.value);
                  setLockError(null);
                }}
                maxLength={32}
                placeholder={t(lang, "unlockPinPlaceholder")}
                className="mt-3 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-center text-lg font-black tracking-[0.15em]"
              />
              {lockError ? <p className="mt-2 text-sm font-bold text-rose-700">{lockError}</p> : null}
              {!isBackOfficePinConfigured(preferences.backOfficePin) &&
              hasPermission(actor.role, "settings.shop") ? (
                <button
                  type="button"
                  className="mt-3 min-h-[44px] w-full rounded-2xl border-2 border-waka-200 bg-waka-50 py-2.5 text-sm font-black text-waka-900"
                  onClick={() => {
                    setPosLocked(false);
                    navigate("/settings/pin", { state: { setupLockPin: true } });
                  }}
                >
                  {t(lang, "settingsHubPin")}
                </button>
              ) : null}
              <button
                type="button"
                className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
                onClick={() => {
                  void (async () => {
                    const selectingOwner = lockStaffId === "__owner__";
                    const activeStaff = (preferences.staffAccounts ?? []).filter((s) => s.active);
                    const selectedStaff = selectingOwner
                      ? null
                      : activeStaff.find((s) => s.id === lockStaffId);
                    const secret = lockSecret.trim();
                    const secretPin = normalizePin(secret);
                    const { staffSecretMatchesAsync } = await import("../../lib/staffSecret");
                    const { verifyShopSecurityPin } = await import(
                      "../../lib/enterpriseSecurity/EnterpriseSecurityService"
                    );

                    let staff = selectedStaff ?? null;
                    if (!staff && !selectingOwner && !lockStaffId) {
                      for (const s of activeStaff) {
                        if (await staffSecretMatchesAsync(s, secret)) {
                          staff = s;
                          break;
                        }
                      }
                    }
                    const validStaff = staff
                      ? await staffSecretMatchesAsync(staff, secret)
                      : false;
                    const validBackOffice = await verifyShopSecurityPin(secretPin, preferences);
                    const canUnlock = validStaff || validBackOffice;
                    if (!canUnlock) {
                      setLockError(t(lang, "enterpriseSecurityWrongPin"));
                      return;
                    }
                    const targetStaffId = staff?.id ?? null;
                    const switchingStaff = (preferences.activeStaffId ?? null) !== targetStaffId;
                    if (switchingStaff && activeShiftForActor) {
                      setPendingStaffUnlock({ staffId: targetStaffId, secret });
                      setStaffSwitchShiftOpen(true);
                      return;
                    }
                    completeStaffUnlock(targetStaffId);
                  })();
                }}
              >
                {t(lang, "unlockSubmit")}
              </button>
              {isInternalAdmin ? (
                <button
                  type="button"
                  className="mt-2 min-h-[42px] w-full rounded-2xl border border-amber-300 bg-amber-50 py-2 text-sm font-black text-amber-900"
                  onClick={() => {
                    usePosStore.getState().setPreferences({ backOfficePin: null });
                    switchStaffAccount(null, { force: true });
                    setPosLocked(false);
                    setLockSecret("");
                    setLockError(null);
                  }}
                >
                  Admin unlock & clear PIN
                </button>
              ) : null}
            </div>
          </AppModalOverlay>
        ) : null}
        {staffSwitchShiftOpen ? (
          <AppModalOverlay className="z-[125] flex items-center justify-center bg-stone-950/85 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <p className="text-xl font-black text-stone-900">{t(lang, "staffSwitchShiftTitle")}</p>
              <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "staffSwitchShiftBody")}</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStaffSwitchShiftOpen(false);
                    setPendingStaffUnlock(null);
                  }}
                  className="min-h-[48px] rounded-2xl border-2 font-bold"
                >
                  {t(lang, "cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStaffSwitchShiftOpen(false);
                    setStaffSwitchCloseOpen(true);
                  }}
                  className="min-h-[48px] rounded-2xl bg-waka-600 font-black text-white"
                >
                  {t(lang, "shiftCloseBtn")}
                </button>
              </div>
            </div>
          </AppModalOverlay>
        ) : null}
        <ShiftCloseModal
          lang={lang}
          open={staffSwitchCloseOpen}
          shift={activeShiftForActor}
          onClose={() => {
            setStaffSwitchCloseOpen(false);
            setPendingStaffUnlock(null);
          }}
          onConfirm={(counted, handoff) => {
            const r = closeShiftWithCashCount(counted, handoff);
            if (!r.ok) {
              setLockError(t(lang, r.errorKey ?? "saleError"));
              return { ok: false };
            }
            setStaffSwitchCloseOpen(false);
            if (pendingStaffUnlock) completeStaffUnlock(pendingStaffUnlock.staffId);
            return { ok: true };
          }}
        />
        {lockSetupHint ? (
          <AppModalOverlay className="z-[115] flex items-center justify-center bg-stone-950/70 p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <p className="text-lg font-black text-stone-900">{t(lang, "lockPos")}</p>
              <p className="mt-2 text-sm font-medium text-stone-600">{lockSetupHint}</p>
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
