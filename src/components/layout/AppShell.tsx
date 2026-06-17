import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { Outlet, useLocation, useNavigate, type NavigateOptions } from "react-router-dom";
import clsx from "clsx";
import { Home, ShoppingCart, Briefcase, Package, ChevronDown } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Language, Permission, UserRole } from "../../types";
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
import { BackOfficeMasterSearch } from "../office/BackOfficeMasterSearch";
import { isHospitalityMode } from "../../lib/hospitality";
import { isPharmacyMode } from "../../lib/pharmacy";
import { isWholesaleMode } from "../../lib/wholesale";
import { isInternalAdminAppPath } from "../../lib/internalAdminPreview";
import { orderNavByPaths, unifiedThirdNavPath } from "../../lib/unifiedNav";

/** Shorter labels on mobile bottom tabs so pharmacy terms are not clipped. */
function mobileBottomNavLabelKey(labelKey: string, pharmacyNav: boolean): string {
  if (!pharmacyNav) return labelKey;
  if (labelKey === "pharmacyTerm_dispensingReceipts") return "pharmacyNav_receipts";
  if (labelKey === "pharmacyTerm_medicineStock") return "pharmacyNav_stock";
  return labelKey;
}
import { BackOfficeRouteGuard } from "./BackOfficeRouteGuard";
import { RouteErrorBoundary } from "../RouteErrorBoundary";
import { PilotModeBanner } from "../pilot/PilotModeBanner";
import { isPilotModeActive } from "../../lib/pilotMode";
import { MobileScrollTail } from "./MobileScrollTail";
import { AppModalOverlay } from "./AppModalOverlay";
import { hashStaffSecret, normalizePin } from "../../lib/staffSecret";
import { resolveEffectivePlanTier } from "../../lib/subscriptionEntitlements";
import { fetchShopMemberRoleForUser } from "../../lib/shopMemberRole";
import { activeStaffCanUnlock, canLockPos, isBackOfficePinConfigured } from "../../lib/lockPos";
import { PinInput } from "../ui/PinInput";
import { confirmLeaveActiveSaleIfNeeded } from "../../lib/posLeaveGuard";
import { lockPosAfterSellExit } from "../../lib/posSellExit";
import { HeaderExitButton } from "./DesktopTerminalBackBar";
import { HeaderBackButton } from "./HeaderBackButton";
import { usePosDesktopLayout } from "../../hooks/usePosDesktopLayout";
import { shouldShowHeaderExit, isIndependentModuleRoute } from "../../lib/headerExit";

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

type NavDef = { path: string; labelKey: string; Icon: typeof Home; perm?: Permission };

function navItemActive(path: string, pathname: string): boolean {
  if (path === "/floor") {
    return pathname === "/floor" || pathname.startsWith("/floor/");
  }
  if (path === "/kitchen") {
    return pathname === "/kitchen" || pathname.startsWith("/kitchen/");
  }
  if (path === "/stock") {
    return pathname === "/stock" || pathname.startsWith("/stock/");
  }
  if (path === "/office") {
    return pathname === "/office" || isBackOfficePath(pathname);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

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
  const beginShift = usePosStore((s) => s.beginShift);
  const endActiveShift = usePosStore((s) => s.endActiveShift);
  const draftLineCount = usePosStore((s) => s.draftLines.length);
  const [pwaUpdate, setPwaUpdate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useAndroidBackHandler("app-menu-drawer", ANDROID_BACK_PRIORITY.menuDrawer, menuOpen, () => setMenuOpen(false));
  const [lockStaffId, setLockStaffId] = useState(preferences.activeStaffId ?? "");
  const [lockSecret, setLockSecret] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockSetupHint, setLockSetupHint] = useState<string | null>(null);
  const [isInternalAdmin, setIsInternalAdmin] = useState(false);
  const [shopMemberRole, setShopMemberRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(() => authMode !== "supabase" || !user?.id);
  const prevActorRef = useRef<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const guardedNavigate = useCallback(
    (to: string, options?: NavigateOptions) => {
      const onPos = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
      const leavingPos = onPos && draftLineCount > 0 && to !== location.pathname && !to.startsWith("/pos");
      if (leavingPos) {
        void confirmLeaveActiveSaleIfNeeded().then((ok) => {
          if (ok) {
            lockPosAfterSellExit();
            navigate(to, options);
          }
        });
        return;
      }
      navigate(to, options);
    },
    [draftLineCount, location.pathname, navigate],
  );

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

  useEffect(() => {
    const prev = prevActorRef.current;
    if (prev && prev !== actor.userId) {
      endActiveShift(prev);
    }
    prevActorRef.current = actor.userId;
    if (!preferences.posLocked) beginShift();
  }, [actor.userId, preferences.posLocked, beginShift, endActiveShift]);

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
  const desktopTerminalHome = isDesktopLayout && location.pathname === "/";
  const onSellScreen = location.pathname === "/pos" || location.pathname.startsWith("/pos/");
  const independentModule = isIndependentModuleRoute(location.pathname);
  /** lg+ terminal layout: full-width chrome outside the classic back-office column. */
  const desktopTerminalMode = isDesktopLayout && !internalAdminRoute;
  const fullWidthChrome = desktopTerminalMode || desktopTerminalHome || independentModule;
  const showHeaderExit =
    shouldShowHeaderExit(location.pathname) || (onSellScreen && !isDesktopLayout);
  const showBackOfficeSearch =
    isBackOfficePath(location.pathname) && !isSettingsLauncherPath(location.pathname) && !internalAdminRoute;

  const hospitalityNav = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled);
  const pharmacyNav = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const wholesaleNav = isWholesaleMode(preferences.businessType);
  const sellNavLabelKey = hospitalityNav ? "navSell" : pharmacyNav ? "navDispense" : wholesaleNav ? "navInvoiceDesk" : "navSell";

  const navDefs = useMemo((): NavDef[] => {
    const items: NavDef[] = [{ path: "/", labelKey: "posNavMainMenu", Icon: Home }];
    if (hasPermission(actor.role, "pos.sell")) {
      items.push({ path: "/pos", labelKey: sellNavLabelKey, Icon: ShoppingCart, perm: "pos.sell" });
    }
    const hasShop = hasPermission(actor.role, "back_office.access");
    const stockOnly = hasPermission(actor.role, "stock.view") && !hasShop;
    const thirdPath = unifiedThirdNavPath(hasShop, stockOnly);
    if (thirdPath === "/office") {
      items.push({ path: "/office", labelKey: "officeHubNav", Icon: Briefcase, perm: "back_office.access" });
    } else if (stockOnly) {
      items.push({
        path: "/stock",
        labelKey:
          pharmacyNav && !hospitalityNav
            ? "pharmacyTerm_medicineStock"
            : wholesaleNav
              ? "navWarehouse"
              : "navStock",
        Icon: Package,
        perm: "stock.view",
      });
    }
    return items.filter((item) => !item.perm || hasPermission(actor.role, item.perm));
  }, [actor.role, hospitalityNav, pharmacyNav, sellNavLabelKey, wholesaleNav]);

  const mobileNavDefs = useMemo(() => {
    const paths: string[] = ["/"];
    if (navDefs.some((item) => item.path === "/pos")) paths.push("/pos");
    const third = navDefs.find((item) => item.path === "/office" || item.path === "/stock");
    if (third) paths.push(third.path);
    return orderNavByPaths(navDefs, paths);
  }, [navDefs]);

  return (
    <SessionHydrationProvider roleReady={roleReady}>
    <SessionActorProvider value={actor}>
      <div
        className={clsx(
          "app-shell-root flex h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden bg-stone-50 text-stone-900 transition-colors duration-300",
          onSellScreen && "app-shell--sell-focus",
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
        <header className="relative z-20 shrink-0 overflow-visible border-b border-stone-200/90 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/90">
          <div
            className={clsx(
              "mx-auto flex flex-wrap items-center justify-between gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-4",
              desktopTerminalMode || desktopTerminalHome || independentModule ? "max-w-none lg:px-8 xl:px-10" : "max-w-6xl",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {showHeaderExit ? <HeaderExitButton lang={lang} /> : null}
              {showHeaderExit ? <HeaderBackButton lang={lang} /> : null}
              <WakaSymbolIcon size="xs" className="h-8 w-8 shrink-0" />
              <div className="min-w-0">
                <AppShellSyncLabel lang={lang} />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex min-h-[38px] max-w-[12rem] touch-manipulation items-center gap-1.5 truncate rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 shadow-sm active:bg-stone-50 sm:max-w-[14rem]"
                >
                  <span className="truncate">{actor.displayName ?? actor.role}</span>
                  <ChevronDown
                    className={clsx("h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform", menuOpen && "rotate-180")}
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
                className="min-h-[38px] max-w-[7.5rem] truncate rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 shadow-sm active:bg-stone-50"
                aria-label={t(lang, "langEnglish")}
              >
                {languageToggleLabel(lang)}
              </button>
            </div>
          </div>
        </header>
        {showBackOfficeSearch ? (
          <div
            className={clsx(
              "relative z-10 shrink-0 border-b border-stone-200/80 bg-white/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:px-4",
              desktopTerminalMode || desktopTerminalHome || independentModule ? "lg:px-8 xl:px-10" : "",
            )}
          >
            <div className={clsx("mx-auto w-full", fullWidthChrome ? "max-w-none" : "max-w-6xl")}>
              <BackOfficeMasterSearch lang={lang} className="max-w-3xl" />
            </div>
          </div>
        ) : null}
        <main
          className={clsx(
            "mx-auto box-border flex min-h-0 w-full flex-1 gap-4 overflow-hidden px-3 py-3 sm:px-4 md:px-6",
            fullWidthChrome ? "max-w-none" : "max-w-6xl",
            fullWidthChrome && !desktopTerminalHome && "lg:px-8 xl:px-10",
          )}
        >
          {!independentModule ? (
          <nav
            className={clsx(
              "hidden w-52 shrink-0 rounded-2xl border border-stone-100 bg-white p-3 shadow-waka-sm md:block xl:w-56",
              onSellScreen && "md:hidden",
            )}
          >
            <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-wider text-stone-400">{t(lang, "navGroupHome")}</p>
            <ul className="space-y-1">
              {navDefs.map((item) => {
                const active = navItemActive(item.path, location.pathname);
                return (
                  <li key={item.path}>
                    <button
                      type="button"
                      onClick={() => guardedNavigate(item.path, { preventScrollReset: true })}
                      className={`flex w-full min-h-[44px] items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold leading-snug transition-waka ${
                        active ? "bg-waka-600 text-white shadow-waka-sm" : "text-stone-700 hover:bg-waka-50"
                      }`}
                    >
                      <item.Icon
                        className={
                          item.path === "/pos"
                            ? "h-7 w-7 shrink-0 opacity-95"
                            : "h-5 w-5 shrink-0 opacity-90"
                        }
                        strokeWidth={item.path === "/pos" ? 2.5 : 2.25}
                        aria-hidden
                      />
                      {t(lang, item.labelKey)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          ) : null}
          <section className={clsx("flex min-h-0 min-w-0 max-w-full flex-1 flex-col", independentModule ? "pb-0" : "md:pb-0")}>
            <div
              className={`scroll-main-chrome min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] ${
                location.pathname === "/pos" || location.pathname.startsWith("/pos/") ? "scroll-main-chrome--pos" : ""
              }`}
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
        {!internalAdminRoute && !independentModule && !onSellScreen ? (
        <nav
          className="fixed bottom-0 left-0 right-0 border-t border-stone-200/90 bg-white/95 shadow-[0_-4px_24px_rgb(28_25_23/0.06)] backdrop-blur md:hidden"
          style={{ zIndex: "var(--waka-z-bottom-nav)" }}
          aria-label="Main navigation"
        >
          <div
            className="mx-auto grid max-w-lg min-h-[var(--waka-bottom-nav-h)] items-end gap-0 px-1.5 pt-1.5 pb-[max(0.375rem,var(--waka-safe-bottom))]"
            style={{ gridTemplateColumns: `repeat(${Math.min(mobileNavDefs.length, 5)}, minmax(0, 1fr))` }}
          >
            {mobileNavDefs.map(({ path, labelKey, Icon }) => {
              const navLabelKey = mobileBottomNavLabelKey(labelKey, pharmacyNav);
              const active = navItemActive(path, location.pathname);
              const isSell = path === "/pos";
              const isHome = path === "/";
              if (isSell) {
                return (
                  <div key={path} className="flex flex-col items-center justify-end">
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      aria-label={t(lang, labelKey)}
                      onClick={() => guardedNavigate(path, { preventScrollReset: true })}
                      className={`touch-manipulation -mt-1.5 flex min-h-[56px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-full px-2.5 py-2 font-black text-white shadow-[0_4px_16px_rgba(234,88,12,0.42)] transition-waka active:scale-[0.96] motion-reduce:active:scale-100 sm:min-h-[60px] sm:min-w-[60px] ${
                        active
                          ? "bg-waka-700 ring-2 ring-waka-300 ring-offset-2 ring-offset-white"
                          : "bg-waka-600 hover:bg-waka-700"
                      }`}
                    >
                      <Icon className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" strokeWidth={2.75} aria-hidden />
                      <span className="waka-mobile-nav-label max-w-[4.75rem] font-black">{t(lang, navLabelKey)}</span>
                    </button>
                  </div>
                );
              }
              if (isHome) {
                return (
                  <button
                    key={path}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => guardedNavigate(path, { preventScrollReset: true })}
                    className={`touch-manipulation flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-2 text-[11px] font-bold leading-tight transition-waka active:scale-[0.97] motion-reduce:active:scale-100 sm:min-h-[52px] sm:text-xs ${
                      active
                        ? "bg-waka-50 text-waka-900 ring-1 ring-waka-200/90"
                        : "text-stone-600 hover:bg-stone-50 hover:text-stone-800"
                    }`}
                  >
                    <Icon
                      className={`h-6 w-6 shrink-0 sm:h-7 sm:w-7 ${active ? "text-waka-700" : ""}`}
                      strokeWidth={active ? 2.5 : 2.25}
                      aria-hidden
                    />
                    <span className="waka-mobile-nav-label max-w-[4.75rem] font-bold">{t(lang, navLabelKey)}</span>
                  </button>
                );
              }
              return (
                <button
                  key={path}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => guardedNavigate(path, { preventScrollReset: true })}
                  className={`touch-manipulation flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 font-semibold transition-waka active:scale-[0.97] motion-reduce:active:scale-100 sm:min-h-[50px] ${
                    active
                      ? "bg-stone-100 text-waka-800 ring-1 ring-stone-200/80"
                      : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 shrink-0 sm:h-[1.35rem] sm:w-[1.35rem] ${active ? "text-waka-700" : ""}`}
                    strokeWidth={active ? 2.4 : 2}
                    aria-hidden
                  />
                  <span className="waka-mobile-nav-label max-w-[4.5rem]">{t(lang, navLabelKey)}</span>
                </button>
              );
            })}
          </div>
        </nav>
        ) : null}
        {preferences.posLocked ? (
          <AppModalOverlay className="z-[120] flex items-center justify-center bg-stone-950/85 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <p className="text-2xl font-black text-stone-900">{t(lang, "lockPosTitle")}</p>
              <p className="mt-1 text-sm text-stone-600">{t(lang, "lockPosSub")}</p>
              {canSwitchUser && (preferences.staffAccounts ?? []).length > 0 ? (
                <label className="mt-4 block text-sm font-bold text-slate-700">
                  {t(lang, "switchUser")}
                  <select
                    value={lockStaffId}
                    onChange={(e) => {
                      setLockStaffId(e.target.value);
                      setLockError(null);
                    }}
                    className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3"
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
              <p className="mt-2 text-xs font-medium text-slate-500">{t(lang, "lockScreenStaffHint")}</p>
              <PinInput
                value={lockSecret}
                onChange={(e) => {
                  setLockSecret(e.target.value);
                  setLockError(null);
                }}
                maxLength={32}
                placeholder={t(lang, "unlockPinPlaceholder")}
                className="mt-3 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center text-lg font-black tracking-[0.15em]"
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
                  const selectingOwner = lockStaffId === "__owner__";
                  const activeStaff = (preferences.staffAccounts ?? []).filter((s) => s.active);
                  const selectedStaff = selectingOwner
                    ? null
                    : activeStaff.find((s) => s.id === lockStaffId);
                  const secret = lockSecret.trim();
                  const secretPin = normalizePin(secret);
                  const secretHash = hashStaffSecret(secret);
                  const secretPinHash = secretPin ? hashStaffSecret(secretPin) : "";
                  const fallbackStaff =
                    !selectingOwner && !lockStaffId
                      ? activeStaff.find(
                          (s) =>
                            (s.pin && s.pin === secretPin) ||
                            (s.password && s.password === secret) ||
                            (s.pinHash && s.pinHash === secretPinHash) ||
                            (s.passwordHash && s.passwordHash === secretHash),
                        )
                      : null;
                  const staff = selectedStaff ?? fallbackStaff ?? null;
                  const validStaff = Boolean(
                    staff &&
                      (
                        (staff.pin && staff.pin === secretPin) ||
                        (staff.password && staff.password === secret) ||
                        (staff.pinHash && staff.pinHash === secretPinHash) ||
                        (staff.passwordHash && staff.passwordHash === secretHash)
                      ),
                  );
                  const validBackOffice = Boolean(
                    isBackOfficePinConfigured(preferences.backOfficePin) &&
                      (preferences.backOfficePin ?? "") === secretPin,
                  );
                  const canUnlock = validStaff || validBackOffice;
                  if (!canUnlock) {
                    setLockError(t(lang, "unlockWrongPin"));
                    return;
                  }
                  switchStaffAccount(staff?.id ?? null);
                  setPosLocked(false);
                  setLockSecret("");
                  setLockError(null);
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
                    switchStaffAccount(null);
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
