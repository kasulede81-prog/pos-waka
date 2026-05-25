import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, ShoppingCart, Receipt, Briefcase } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { languageToggleLabel, nextLanguage } from "../../lib/language";
import { useSubscription } from "../../context/SubscriptionContext";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { useAndroidBackButton } from "../../hooks/useAndroidBackButton";
import { usePosStore } from "../../store/usePosStore";
import { resolveSessionActor } from "../../lib/sessionActor";
import { SessionActorProvider } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import { fetchWakaInternalAdminMe } from "../../lib/wakaInternalAdmin";
import { WakaMarkIcon } from "../brand/WakaLogo";
import { isBackOfficePath } from "../../lib/backOfficePaths";
import { BackOfficeRouteGuard } from "./BackOfficeRouteGuard";
import { FloatingSupportFab } from "../support/FloatingSupportFab";

type Props = {
  lang: Language;
  setLang: (lang: Language) => void;
  onSignOut: () => Promise<void>;
  user: User | null;
  email: string | null | undefined;
  authMode: "supabase" | "local";
};

type NavDef = { path: string; labelKey: string; Icon: typeof Home; perm?: Permission };

function syncStripLabel(lang: Language, status: ReturnType<typeof useSyncStatus>, online: boolean): string {
  if (!online) return `${t(lang, "workingOfflineLabel")} · ${t(lang, "savedOffline")}`;
  if (status.syncing) return t(lang, "syncingShort");
  if (status.pendingCount > 0) return `${t(lang, "willSyncLater")} (${status.pendingCount})`;
  return t(lang, "allSavedShort");
}

function navItemActive(path: string, pathname: string): boolean {
  if (path === "/office") {
    return pathname === "/office" || isBackOfficePath(pathname);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function AppShell({ lang, setLang, onSignOut, user, email, authMode }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  useAndroidBackButton();
  const { isOnline } = useOfflineStatus();
  const sync = useSyncStatus();
  const preferences = usePosStore((s) => s.preferences);
  const { authMode: subAuthMode } = useSubscription();
  const setPosLocked = usePosStore((s) => s.setPosLocked);
  const switchStaffAccount = usePosStore((s) => s.switchStaffAccount);
  const beginShift = usePosStore((s) => s.beginShift);
  const endActiveShift = usePosStore((s) => s.endActiveShift);
  const [pwaUpdate, setPwaUpdate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lockStaffId, setLockStaffId] = useState(preferences.activeStaffId ?? "");
  const [lockSecret, setLockSecret] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  const [isInternalAdmin, setIsInternalAdmin] = useState(false);
  const prevActorRef = useRef<string | null>(null);
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

  const actor = useMemo(
    () => resolveSessionActor({ mode: authMode, user, email, preferences }),
    [authMode, user, email, preferences],
  );

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

  const navDefs = useMemo((): NavDef[] => {
    const items: NavDef[] = [{ path: "/", labelKey: "navHome", Icon: Home }];
    if (hasPermission(actor.role, "pos.sell")) {
      items.push({ path: "/pos", labelKey: "navSell", Icon: ShoppingCart, perm: "pos.sell" });
    }
    if (hasPermission(actor.role, "receipts.view")) {
      items.push({ path: "/receipts", labelKey: "receipts", Icon: Receipt, perm: "receipts.view" });
    }
    if (hasPermission(actor.role, "back_office.access")) {
      items.push({ path: "/office", labelKey: "officeHubNav", Icon: Briefcase, perm: "back_office.access" });
    }
    return items.filter((item) => !item.perm || hasPermission(actor.role, item.perm));
  }, [actor.role]);

  return (
    <SessionActorProvider value={actor}>
      <div className="app-shell-root flex h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden bg-stone-50 text-stone-900 transition-colors duration-300">
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
        <header className="relative z-20 shrink-0 overflow-visible border-b border-stone-200/90 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/90">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <WakaMarkIcon className="h-8 w-8 shrink-0 text-waka-600 shadow-waka-sm" aria-hidden />
              <div className="min-w-0">
                <h1 className="truncate text-base font-black tracking-tight text-stone-900">{t(lang, "appName")}</h1>
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                  {t(lang, "brandTagline")}
                </p>
                <p className="truncate text-[11px] font-medium text-waka-800/90">{syncStripLabel(lang, sync, isOnline)}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="min-h-[38px] max-w-[10rem] truncate rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 shadow-sm active:bg-stone-50 sm:max-w-[12rem]"
                >
                  {actor.displayName ?? actor.role}
                </button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-52 origin-top-right rounded-xl border border-stone-200 bg-white py-1 shadow-lg ring-1 ring-stone-900/5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50"
                      onClick={() => {
                        setPosLocked(true);
                        setMenuOpen(false);
                      }}
                    >
                      {t(lang, "lockPos")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50"
                      onClick={() => {
                        setPosLocked(true);
                        setMenuOpen(false);
                      }}
                    >
                      {t(lang, "switchUser")}
                    </button>
                    {subAuthMode === "supabase" ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-sm font-semibold text-waka-900 hover:bg-waka-50"
                        onClick={() => {
                          setMenuOpen(false);
                          navigate("/upgrade", { preventScrollReset: true });
                        }}
                      >
                        {t(lang, "upgradeNav")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/support", { preventScrollReset: true });
                      }}
                    >
                      {t(lang, "supportNav")}
                    </button>
                    {isInternalAdmin ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-sm font-semibold text-orange-900 hover:bg-orange-50"
                        onClick={() => {
                          setMenuOpen(false);
                          navigate("/internal/waka", { preventScrollReset: true });
                        }}
                      >
                        Internal dashboard
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
                      className="mx-2 mb-1 block w-[calc(100%-1rem)] rounded-lg bg-stone-900 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-stone-800"
                    >
                      {t(lang, "signOut")}
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
        <main className="scroll-main-chrome mx-auto box-border flex min-h-0 w-full max-w-6xl flex-1 gap-4 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 max-lg:pb-nav-safe sm:px-4 lg:px-6 lg:pb-8">
          <nav className="hidden w-52 shrink-0 rounded-2xl border border-stone-100 bg-white p-3 shadow-waka-sm lg:block xl:w-56">
            <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-wider text-stone-400">{t(lang, "navGroupHome")}</p>
            <ul className="space-y-1">
              {navDefs.map((item) => {
                const active = navItemActive(item.path, location.pathname);
                return (
                  <li key={item.path}>
                    <button
                      type="button"
                      onClick={() => navigate(item.path, { preventScrollReset: true })}
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
          <section className="min-w-0 max-w-full flex-1 lg:pb-0">
            <BackOfficeRouteGuard lang={lang}>
              <Outlet />
            </BackOfficeRouteGuard>
          </section>
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-[45] border-t border-stone-200/90 bg-white/95 shadow-[0_-4px_24px_rgb(28_25_23/0.06)] backdrop-blur lg:hidden">
          <div
            className="mx-auto grid max-w-lg gap-0.5 px-1 py-2 pb-bottom-nav"
            style={{ gridTemplateColumns: `repeat(${Math.min(navDefs.length, 5)}, minmax(0, 1fr))` }}
          >
            {navDefs.map(({ path, labelKey, Icon }) => {
              const active = navItemActive(path, location.pathname);
              const isSell = path === "/pos";
              return (
                <button
                  key={path}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => navigate(path, { preventScrollReset: true })}
                  className={`touch-manipulation flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-bold leading-tight transition-waka active:scale-[0.97] motion-reduce:active:scale-100 sm:text-[11px] ${
                    active ? "bg-waka-600 text-white shadow-waka-sm" : "text-stone-700"
                  } ${isSell && !active ? "ring-2 ring-waka-200 ring-offset-1" : ""} ${isSell ? "sm:min-h-[56px]" : ""}`}
                >
                  <Icon
                    className={isSell ? "h-9 w-9 shrink-0 sm:h-10 sm:w-10" : "h-6 w-6 shrink-0"}
                    strokeWidth={isSell ? 2.6 : 2.25}
                    aria-hidden
                  />
                  <span className="max-w-[4.5rem] truncate text-center">{t(lang, labelKey)}</span>
                </button>
              );
            })}
          </div>
        </nav>
        {preferences.posLocked ? (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-950/85 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <p className="text-2xl font-black text-stone-900">{t(lang, "lockPosTitle")}</p>
              <p className="mt-1 text-sm text-stone-600">{t(lang, "lockPosSub")}</p>
              {(preferences.staffAccounts ?? []).length > 0 ? (
                <label className="mt-4 block text-sm font-bold text-slate-700">
                  {t(lang, "switchUser")}
                  <select
                    value={lockStaffId}
                    onChange={(e) => setLockStaffId(e.target.value)}
                    className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3"
                  >
                    <option value="">{t(lang, "staffPickAccount")}</option>
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
              <input
                value={lockSecret}
                onChange={(e) => setLockSecret(e.target.value)}
                type="password"
                placeholder={t(lang, "unlockPinPlaceholder")}
                className="mt-3 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
              {lockError ? <p className="mt-2 text-sm font-bold text-rose-700">{lockError}</p> : null}
              <button
                type="button"
                className="mt-4 min-h-[48px] w-full rounded-2xl bg-waka-600 py-3 text-base font-black text-white"
                onClick={() => {
                  const staff = (preferences.staffAccounts ?? []).find((s) => s.id === lockStaffId && s.active);
                  const secret = lockSecret.trim();
                  const validStaff = Boolean(staff && ((staff.pin && staff.pin === secret.replace(/\D/g, "")) || (staff.password && staff.password === secret)));
                  const validBackOffice = Boolean((preferences.backOfficePin ?? "") && (preferences.backOfficePin ?? "") === secret.replace(/\D/g, ""));
                  const canUnlock = validStaff || validBackOffice || (!staff && !(preferences.backOfficePin ?? "").length);
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
            </div>
          </div>
        ) : null}
        <FloatingSupportFab lang={lang} />
      </div>
    </SessionActorProvider>
  );
}
