import { useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { WakaInternalAdminRow } from "../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../lib/internalAdminPreview";
import { AdminSectionSelect } from "./adminUi";

function useLockUnderlyingAppScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const shell = document.querySelector<HTMLElement>(".app-shell-root");
    const scroller = document.querySelector<HTMLElement>(".scroll-main-chrome");
    const prevShell = shell?.style.overflow ?? "";
    const prevScroller = scroller?.style.overflow ?? "";
    if (shell) shell.style.overflow = "hidden";
    if (scroller) scroller.style.overflow = "hidden";
    return () => {
      if (shell) shell.style.overflow = prevShell;
      if (scroller) scroller.style.overflow = prevScroller;
    };
  }, [active]);
}

type TabRoute = "/internal/waka" | "/internal/waka/activations" | "/internal/waka/admins" | "/internal/waka/agents";

const TABS: { to: TabRoute; label: string; active: Props["active"]; superOnly?: boolean }[] = [
  { to: "/internal/waka", label: "Overview", active: "overview" },
  { to: "/internal/waka/activations", label: "Activations", active: "activations" },
  { to: "/internal/waka/agents", label: "Agents", active: "agents" },
  { to: "/internal/waka/admins", label: "Admins", active: "admins", superOnly: true },
];

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  loading: boolean;
  active: "overview" | "activations" | "admins" | "agents" | "shop";
  previewMode?: boolean;
  children: ReactNode;
};

export function WakaAdminShell({ lang, adminRow, loading, active, previewMode = false, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  useLockUnderlyingAppScroll(true);

  const isSuper = adminRow?.role === "super_admin";
  const tabTo = (path: TabRoute) => (previewMode ? internalAdminPreviewHref(path) : path);

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => !tab.superOnly || isSuper),
    [isSuper],
  );

  const navOptions = useMemo(
    () => visibleTabs.map((tab) => ({ value: tabTo(tab.to), label: tab.label })),
    [visibleTabs, previewMode],
  );

  if (loading) {
    return createPortal(
      <div className="waka-internal-admin-root fixed inset-0 flex h-[100dvh] flex-col items-center justify-center bg-stone-100 font-admin">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        <p className="mt-3 text-sm font-semibold text-stone-600">Loading admin…</p>
      </div>,
      document.body,
    );
  }

  if (!adminRow && !previewMode) {
    return <Navigate to="/" replace />;
  }

  const row = adminRow!;

  const currentTabPath =
    active === "shop"
      ? tabTo("/internal/waka")
      : tabTo((visibleTabs.find((tab) => tab.active === active)?.to ?? "/internal/waka") as TabRoute);

  const locationPath = `${location.pathname}${location.search}`;

  const handleBack = () => {
    if (active === "shop") {
      navigate(tabTo("/internal/waka"));
      return;
    }
    if (active !== "overview") {
      navigate(tabTo("/internal/waka"));
    }
  };

  const showBack = active !== "overview";
  const pageTitle =
    active === "shop"
      ? t(lang, "internalShopProfileTitle")
      : visibleTabs.find((tab) => tab.active === active)?.label ?? "Admin";

  return createPortal(
    <div className="waka-internal-admin-root fixed inset-0 flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-stone-100 font-admin text-stone-900">
      <header className="shrink-0 bg-orange-600 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          {showBack ? (
            <button
              type="button"
              onClick={handleBack}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full hover:bg-white/10"
              aria-label={t(lang, "internalAdminBack")}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10" aria-hidden>
              <ShieldCheck className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black leading-tight sm:text-lg">{pageTitle}</p>
            <p className="truncate text-[10px] opacity-90 sm:text-xs">{row.full_name || row.email || "Internal team"}</p>
          </div>
          {previewMode ? (
            <span className="hidden shrink-0 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black uppercase text-amber-950 sm:inline">
              {t(lang, "internalDashPreviewBadge")}
            </span>
          ) : null}
          <Link
            to="/office"
            className="shrink-0 rounded-full bg-white/15 px-2.5 py-1.5 text-[10px] font-bold hover:bg-white/25 sm:px-3 sm:text-xs"
          >
            {t(lang, "internalAdminExitOffice")}
          </Link>
        </div>
      </header>

      {active !== "shop" ? (
        <div className="shrink-0 border-b border-stone-200 bg-white px-3 py-2 sm:px-4">
          <AdminSectionSelect
            label={t(lang, "internalAdminNavSelect")}
            value={currentTabPath}
            onChange={(path) => {
              if (path && path !== locationPath) navigate(path);
            }}
            options={navOptions}
          />
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-stone-50/80 [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto w-full max-w-7xl p-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-4">{children}</div>
      </main>
    </div>,
    document.body,
  );
}
