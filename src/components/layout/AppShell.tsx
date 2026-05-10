import { useLayoutEffect, useMemo } from "react";
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

  const actor = useMemo(
    () => resolveSessionActor({ mode: authMode, user, email, preferences }),
    [authMode, user, email, preferences],
  );

  useLayoutEffect(() => {
    usePosStore.getState().setSessionActor(actor);
  }, [actor]);

  const effectiveUiMode = canTogglePosUiMode(actor.role) ? (preferences.posUiMode ?? "cashier") : "cashier";

  const desktopItems = useMemo(() => {
    return desktopNavDefs.filter((item) => {
      if (item.perm && !hasPermission(actor.role, item.perm)) return false;
      if (item.path === "/owner" && effectiveUiMode !== "owner_back_office") return false;
      if (item.path === "/reports" && !hasPermission(actor.role, "reports.profit") && actor.role === "cashier") {
        return false;
      }
      return true;
    });
  }, [actor.role, effectiveUiMode]);

  const mobileNav = useMemo(() => {
    const officeOn = hasPermission(actor.role, "nav.office") && effectiveUiMode === "owner_back_office";
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
  }, [actor.role, effectiveUiMode]);

  const showModeToggle = hasPermission(actor.role, "ui.toggle_mode");

  return (
    <SessionActorProvider value={actor}>
      <div className="min-h-dvh bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:px-4">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">{t(lang, "appName")}</h1>
              <p className="truncate text-xs font-medium text-emerald-800/90">{syncStripLabel(lang, sync, isOnline)}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {showModeToggle ? (
                <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreferences({ posUiMode: "cashier" })}
                    className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-bold ${
                      effectiveUiMode === "cashier" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                    }`}
                  >
                    {t(lang, "modeCashier")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferences({ posUiMode: "owner_back_office" })}
                    className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-bold ${
                      effectiveUiMode === "owner_back_office" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                    }`}
                  >
                    {t(lang, "modeOffice")}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setLang(lang === "en" ? "lg" : "en")}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm active:bg-slate-50 sm:text-sm"
              >
                {lang === "en" ? "Luganda" : "English"}
              </button>
              <button
                type="button"
                onClick={() => onSignOut()}
                className="min-h-[44px] rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm active:bg-slate-800 sm:text-sm"
              >
                {t(lang, "signOut")}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl gap-4 px-3 py-4 pb-nav-safe sm:px-4 lg:pb-6">
          <nav className="hidden w-52 shrink-0 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm lg:block xl:w-56">
            <ul className="space-y-1">
              {desktopItems.map((item) => {
                const active = location.pathname === item.path || (item.path === "/owner" && location.pathname.startsWith("/owner"));
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={`block min-h-[44px] rounded-xl px-3 py-2.5 text-sm font-semibold leading-snug ${
                        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
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
        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur lg:hidden">
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
                  className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-bold leading-tight active:scale-[0.97] motion-reduce:active:scale-100 sm:text-[11px] ${
                    active ? "bg-slate-900 text-white shadow-md" : "text-slate-700"
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
