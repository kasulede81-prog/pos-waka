import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Home, ScanLine, HandCoins, Receipt, Briefcase } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { useAndroidBackButton } from "../../hooks/useAndroidBackButton";
import { usePosStore } from "../../store/usePosStore";
import { resolveSessionActor } from "../../lib/sessionActor";
import { SessionActorProvider } from "../../context/SessionActorContext";
import { hasPermission } from "../../lib/permissions";
import { WakaMarkIcon } from "../brand/WakaLogo";
import { isBackOfficePath } from "../../lib/backOfficePaths";
import { BackOfficeRouteGuard } from "./BackOfficeRouteGuard";

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
  useAndroidBackButton();
  const { isOnline } = useOfflineStatus();
  const sync = useSyncStatus();
  const preferences = usePosStore((s) => s.preferences);
  const setPosLocked = usePosStore((s) => s.setPosLocked);
  const switchStaffAccount = usePosStore((s) => s.switchStaffAccount);
  const beginShift = usePosStore((s) => s.beginShift);
  const endActiveShift = usePosStore((s) => s.endActiveShift);
  const [pwaUpdate, setPwaUpdate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lockStaffId, setLockStaffId] = useState(preferences.activeStaffId ?? "");
  const [lockSecret, setLockSecret] = useState("");
  const [lockError, setLockError] = useState<string | null>(null);
  const prevActorRef = useRef<string | null>(null);

  useEffect(() => {
    const onUp = () => setPwaUpdate(true);
    window.addEventListener("waka:pwa-update", onUp);
    return () => window.removeEventListener("waka:pwa-update", onUp);
  }, []);

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

  const navDefs = useMemo((): NavDef[] => {
    const items: NavDef[] = [{ path: "/", labelKey: "navHome", Icon: Home }];
    if (hasPermission(actor.role, "pos.sell")) {
      items.push({ path: "/pos", labelKey: "navSell", Icon: ScanLine, perm: "pos.sell" });
    }
    if (hasPermission(actor.role, "customers.view")) {
      items.push({ path: "/debts", labelKey: "debts", Icon: HandCoins, perm: "customers.view" });
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
      <div className="min-h-dvh bg-stone-50 text-stone-900 transition-colors duration-300">
        {pwaUpdate ? (
          <div className="sticky top-0 z-40 border-b border-waka-200 bg-waka-50 px-3 py-2 text-center shadow-sm">
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
        <header className="sticky top-0 z-20 border-b border-stone-200/90 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/90">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <WakaMarkIcon className="h-10 w-10 shrink-0 text-waka-600 shadow-waka-sm" aria-hidden />
              <div className="min-w-0">
                <h1 className="truncate text-lg font-black tracking-tight text-stone-900">{t(lang, "appName")}</h1>
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  {t(lang, "brandTagline")}
                </p>
                <p className="truncate text-xs font-medium text-waka-800/90">{syncStripLabel(lang, sync, isOnline)}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 shadow-sm active:bg-stone-50 sm:text-sm"
              >
                {actor.displayName ?? actor.role}
              </button>
              <button
                type="button"
                onClick={() => setLang(lang === "en" ? "lg" : "en")}
                className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 shadow-sm active:bg-stone-50 sm:text-sm"
              >
                {lang === "en" ? "Luganda" : "English"}
              </button>
              {menuOpen ? (
                <div className="w-full rounded-2xl border border-stone-200 bg-white p-2 shadow-waka-sm sm:w-auto">
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-stone-800 hover:bg-stone-50"
                    onClick={() => {
                      setPosLocked(true);
                      setMenuOpen(false);
                    }}
                  >
                    {t(lang, "lockPos")}
                  </button>
                  <button
                    type="button"
                    className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-stone-800 hover:bg-stone-50"
                    onClick={() => {
                      setPosLocked(true);
                      setMenuOpen(false);
                    }}
                  >
                    {t(lang, "switchUser")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSignOut()}
                    className="mt-1 w-full rounded-xl bg-stone-900 px-3 py-2 text-left text-sm font-semibold text-white"
                  >
                    {t(lang, "signOut")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl gap-4 px-3 py-4 pb-nav-safe sm:px-4 lg:pb-6">
          <nav className="hidden w-52 shrink-0 rounded-2xl border border-stone-100 bg-white p-3 shadow-waka-sm lg:block xl:w-56">
            <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-wider text-stone-400">{t(lang, "navGroupHome")}</p>
            <ul className="space-y-1">
              {navDefs.map((item) => {
                const active = navItemActive(item.path, location.pathname);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold leading-snug transition-waka ${
                        active ? "bg-waka-600 text-white shadow-waka-sm" : "text-stone-700 hover:bg-waka-50"
                      }`}
                    >
                      <item.Icon className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                      {t(lang, item.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <section className="min-w-0 flex-1 lg:pb-0">
            <BackOfficeRouteGuard lang={lang}>
              <Outlet />
            </BackOfficeRouteGuard>
          </section>
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-stone-200/90 bg-white/95 shadow-[0_-4px_24px_rgb(28_25_23/0.06)] backdrop-blur lg:hidden">
          <div
            className="mx-auto grid max-w-lg gap-0.5 px-1 py-2 pb-bottom-nav"
            style={{ gridTemplateColumns: `repeat(${Math.min(navDefs.length, 5)}, minmax(0, 1fr))` }}
          >
            {navDefs.map(({ path, labelKey, Icon }) => {
              const active = navItemActive(path, location.pathname);
              return (
                <Link
                  key={path}
                  to={path}
                  className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-bold leading-tight transition-waka active:scale-[0.97] motion-reduce:active:scale-100 sm:text-[11px] ${
                    active ? "bg-waka-600 text-white shadow-waka-sm" : "text-stone-700"
                  }`}
                >
                  <Icon className="h-6 w-6 shrink-0" strokeWidth={2.25} aria-hidden />
                  <span className="max-w-[4.5rem] truncate text-center">{t(lang, labelKey)}</span>
                </Link>
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
      </div>
    </SessionActorProvider>
  );
}
