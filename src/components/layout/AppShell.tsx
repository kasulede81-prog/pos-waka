import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Home, Package, ScanLine, Settings, CalendarCheck, LayoutDashboard } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Language, Permission } from "../../types";
import { t } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { useAndroidBackButton } from "../../hooks/useAndroidBackButton";
import { usePosStore } from "../../store/usePosStore";
import { resolveSessionActor } from "../../lib/sessionActor";
import { SessionActorProvider } from "../../context/SessionActorContext";
import { canTogglePosUiMode, hasPermission } from "../../lib/permissions";
import { WakaMarkIcon } from "../brand/WakaLogo";

type Props = {
  lang: Language;
  setLang: (lang: Language) => void;
  onSignOut: () => Promise<void>;
  user: User | null;
  email: string | null | undefined;
  authMode: "supabase" | "local";
};

type NavDef = { path: string; labelKey: string; perm?: Permission };

const desktopNavDefs: NavDef[] = [
  { path: "/", labelKey: "dashboard" },
  { path: "/stock", labelKey: "stock", perm: "stock.view" },
  { path: "/restock", labelKey: "navRestock", perm: "purchases.record" },
  { path: "/suppliers", labelKey: "navSuppliers", perm: "suppliers.view" },
  { path: "/pos", labelKey: "pos", perm: "pos.sell" },
  { path: "/close-day", labelKey: "closeDayNav", perm: "day.close" },
  { path: "/reports", labelKey: "reports", perm: "reports.view" },
  { path: "/customers", labelKey: "customers", perm: "customers.view" },
  { path: "/receipts", labelKey: "receipts", perm: "reports.view" },
  { path: "/owner", labelKey: "officeNav", perm: "nav.office" },
  { path: "/settings", labelKey: "settings", perm: "settings.view" },
];

function syncStripLabel(lang: Language, status: ReturnType<typeof useSyncStatus>, online: boolean): string {
  if (!online) return `${t(lang, "workingOfflineLabel")} · ${t(lang, "savedOffline")}`;
  if (status.syncing) return t(lang, "syncingShort");
  if (status.pendingCount > 0) return `${t(lang, "willSyncLater")} (${status.pendingCount})`;
  return t(lang, "allSavedShort");
}

export function AppShell({ lang, setLang, onSignOut, user, email, authMode }: Props) {
  const location = useLocation();
  useAndroidBackButton();
  const { isOnline } = useOfflineStatus();
  const sync = useSyncStatus();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [pwaUpdate, setPwaUpdate] = useState(false);

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

  const effectiveUiMode = canTogglePosUiMode(actor.role) ? (preferences.posUiMode ?? "cashier") : "cashier";
  const isOwnerOffice = effectiveUiMode === "owner_back_office";

  const desktopItems = useMemo(() => {
    return desktopNavDefs.filter((item) => {
      if (item.perm && !hasPermission(actor.role, item.perm)) return false;
      if (item.path === "/owner" && !isOwnerOffice) return false;
      if (item.path === "/reports" && !hasPermission(actor.role, "reports.profit") && actor.role === "cashier") {
        return false;
      }
      return true;
    });
  }, [actor.role, isOwnerOffice]);

  const mobileNav = useMemo(() => {
    const officeOn = hasPermission(actor.role, "nav.office") && isOwnerOffice;
    const base: Array<{ path: string; labelKey: string; Icon: typeof Home; perm?: Permission }> = [
      { path: "/", labelKey: "navHome", Icon: Home },
      { path: "/stock", labelKey: "navStock", Icon: Package, perm: "stock.view" },
    ];
    if (hasPermission(actor.role, "pos.sell")) {
      base.push({ path: "/pos", labelKey: "navSell", Icon: ScanLine, perm: "pos.sell" });
    }
    if (officeOn) {
      base.push({ path: "/owner", labelKey: "officeNav", Icon: LayoutDashboard, perm: "nav.office" });
    } else if (hasPermission(actor.role, "day.close")) {
      base.push({ path: "/close-day", labelKey: "closeDayNav", Icon: CalendarCheck, perm: "day.close" });
    }
    base.push({ path: "/settings", labelKey: "navSettings", Icon: Settings, perm: "settings.view" });
    return base.filter((item) => !item.perm || hasPermission(actor.role, item.perm));
  }, [actor.role, isOwnerOffice]);

  const showModeToggle = hasPermission(actor.role, "ui.toggle_mode");

  const shellBg = isOwnerOffice ? "bg-gradient-to-b from-waka-50/90 via-stone-50 to-stone-100" : "bg-stone-50";

  return (
    <SessionActorProvider value={actor}>
      <div className={`min-h-dvh text-stone-900 transition-colors duration-300 ${shellBg}`}>
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
              {showModeToggle ? (
                <div className="flex rounded-xl border border-stone-200 bg-stone-50 p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setPreferences({ posUiMode: "cashier" })}
                    className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-bold transition-waka ${
                      effectiveUiMode === "cashier" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600"
                    }`}
                  >
                    {t(lang, "modeCashier")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferences({ posUiMode: "owner_back_office" })}
                    className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-bold transition-waka ${
                      effectiveUiMode === "owner_back_office" ? "bg-white text-stone-900 shadow-sm" : "text-stone-600"
                    }`}
                  >
                    {t(lang, "modeOffice")}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setLang(lang === "en" ? "lg" : "en")}
                className="min-h-[44px] rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 shadow-sm active:bg-stone-50 sm:text-sm"
              >
                {lang === "en" ? "Luganda" : "English"}
              </button>
              <button
                type="button"
                onClick={() => onSignOut()}
                className="min-h-[44px] rounded-xl bg-stone-900 px-3 py-2 text-xs font-semibold text-white shadow-sm active:bg-stone-800 sm:text-sm"
              >
                {t(lang, "signOut")}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl gap-4 px-3 py-4 pb-nav-safe sm:px-4 lg:pb-6">
          <nav className="hidden w-52 shrink-0 rounded-2xl border border-stone-100 bg-white p-3 shadow-waka-sm lg:block xl:w-56">
            <ul className="space-y-1">
              {desktopItems.map((item) => {
                const active = location.pathname === item.path || (item.path === "/owner" && location.pathname.startsWith("/owner"));
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`block min-h-[44px] rounded-xl px-3 py-2.5 text-sm font-semibold leading-snug transition-waka ${
                        active ? "bg-waka-600 text-white shadow-waka-sm" : "text-stone-700 hover:bg-waka-50"
                      }`}
                    >
                      {t(lang, item.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <section className="min-w-0 flex-1 lg:pb-0">
            <Outlet />
          </section>
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-stone-200/90 bg-white/95 shadow-[0_-4px_24px_rgb(28_25_23/0.06)] backdrop-blur lg:hidden">
          <div
            className="mx-auto grid max-w-lg gap-0.5 px-1 py-2 pb-bottom-nav"
            style={{ gridTemplateColumns: `repeat(${Math.min(mobileNav.length, 5)}, minmax(0, 1fr))` }}
          >
            {mobileNav.map(({ path, labelKey, Icon }) => {
              const active =
                location.pathname === path || (path === "/owner" && location.pathname.startsWith("/owner"));
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
      </div>
    </SessionActorProvider>
  );
}
