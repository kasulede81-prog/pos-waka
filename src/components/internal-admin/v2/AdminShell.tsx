import { useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useNavigate } from "@/lib/routerCompat";
import { ArrowLeft, Boxes, Headphones, LayoutDashboard, Settings2 } from "lucide-react";
import { WakaPageLoading } from "../../enterprise/WakaLoading";
import { WakaSymbolIcon } from "../../brand/WakaLogo";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { WakaInternalAdminRow } from "../../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../../lib/internalAdminPreview";
import { useAdminGlobalSearchData } from "../../../hooks/useAdminGlobalSearchData";
import { GlobalSearchBar } from "./ops/OpsWidgets";
import { themeUi } from "../../../lib/themeTokens";
import { canManageAi, normalizeAdminRole } from "./adminRoles";

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

export type AdminSectionId =
  | "overview"
  | "shops"
  | "devices"
  | "agents"
  | "support"
  | "billing"
  | "pricing_campaigns"
  | "analytics"
  | "activations"
  | "admins"
  | "pilot"
  | "business_types"
  | "growth_campaign"
  | "ai_settings"
  | "subscription_settings"
  | "releases"
  | "display_scale"
  | "remote_support"
  | "platform"
  | "shop";

type TabDef = {
  id: AdminSectionId;
  path: string;
  label: string;
  superOnly?: boolean;
  aiAdmin?: boolean;
};

const PRIMARY_NAV: Array<TabDef & { icon: typeof LayoutDashboard }> = [
  { id: "overview", path: "/internal/waka", label: "Command Center", icon: LayoutDashboard },
  { id: "shops", path: "/internal/waka/shops", label: "Customers", icon: Boxes },
  { id: "support", path: "/internal/waka/support", label: "Support", icon: Headphones },
  { id: "platform", path: "/internal/waka/platform", label: "Platform", icon: Settings2 },
];

const PLATFORM_SECTIONS = new Set<AdminSectionId>([
  "billing", "pricing_campaigns", "analytics", "activations", "admins", "agents", "pilot",
  "business_types", "growth_campaign", "ai_settings", "subscription_settings", "releases",
  "display_scale", "remote_support", "devices",
]);

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  loading: boolean;
  active: AdminSectionId;
  previewMode?: boolean;
  children: ReactNode;
};

function filterTabs(tabs: TabDef[], opts: { isSuper: boolean; canManageAi: boolean }): TabDef[] {
  return tabs.filter((tab) => {
    if (tab.superOnly && !opts.isSuper) return false;
    if (tab.aiAdmin && !opts.canManageAi) return false;
    return true;
  });
}

export function AdminShell({ lang, adminRow, loading, active, previewMode = false, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  useLockUnderlyingAppScroll(true);
  const searchData = useAdminGlobalSearchData(previewMode);

  const isSuper = adminRow?.role === "super_admin";
  const manageAi = canManageAi(normalizeAdminRole(adminRow?.role)) || previewMode;
  const tabTo = (path: string) => (previewMode ? internalAdminPreviewHref(path) : path);

  const visiblePrimary = useMemo(
    () => filterTabs(PRIMARY_NAV, { isSuper, canManageAi: manageAi }),
    [isSuper, manageAi],
  );

  if (loading) {
    return createPortal(
      <WakaPageLoading message="Connecting to WAKA Operations…" className="waka-internal-admin-root fixed inset-0 font-admin" />,
      document.body,
    );
  }

  if (!adminRow && !previewMode) {
    return <Navigate to="/" replace />;
  }

  if (!adminRow) return null;
  const row = adminRow;
  const roleLabel = (row.role ?? "admin").replace(/_/g, " ");
  const showNav = active !== "shop";
  const showBack = active === "shop";
  const currentPath = location.pathname + location.search;

  const renderNavButton = (tab: TabDef, compact?: boolean) => {
    const href = tabTo(tab.path);
    const isActive = active === tab.id || (tab.id === "platform" && PLATFORM_SECTIONS.has(active));
    const Icon = PRIMARY_NAV.find((item) => item.id === tab.id)?.icon;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => {
          if (href !== currentPath) navigate(href);
        }}
        className={clsx(
          compact
            ? "shrink-0 rounded-xl px-3 py-2.5 text-xs font-black transition min-h-[44px]"
            : "rounded-xl px-3 py-2 text-left text-sm font-bold transition min-h-[40px] w-full",
          isActive
            ? compact
              ? "bg-waka-600 text-white shadow-sm"
              : "bg-waka-50 text-waka-800 ring-1 ring-waka-200"
            : compact
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60",
        )}
      >
        <span className="flex items-center gap-2">{Icon ? <Icon className="size-4" aria-hidden /> : null}{tab.label}</span>
      </button>
    );
  };

  return createPortal(
    <div className={clsx("waka-internal-admin-root fixed inset-0 flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-background font-admin", themeUi.adminPage)}>
      <header className="shrink-0 border-b border-border bg-card text-foreground shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:px-4">
          {showBack ? (
            <button
               data-admin-back-to-customers
              type="button"
              onClick={() => navigate(tabTo("/internal/waka/shops"))}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl hover:bg-white/10"
              aria-label={t(lang, "internalAdminBack")}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-card p-1.5 shadow-sm" aria-hidden>
              <WakaSymbolIcon size="sm" className="h-full w-full" />
            </span>
          )}
          <div className="min-w-0 flex-1">
             <p className="truncate text-base font-black leading-tight">WAKA Operations</p>
             <p className="truncate text-[11px] text-muted-foreground">
               {row.full_name || "Waka Admin"} · {roleLabel} · {row.assigned_district_ids?.length ?? 0} districts
            </p>
          </div>
          {previewMode ? (
            <span className="hidden shrink-0 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black uppercase text-amber-950 sm:inline">
              Preview
            </span>
          ) : null}
          <Link
            to="/office"
             className="shrink-0 rounded-lg border border-border bg-muted px-3 py-2 text-[11px] font-bold hover:bg-accent"
          >
            {t(lang, "internalAdminExitOffice")}
          </Link>
        </div>
        {showNav ? (
           <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4">
            <GlobalSearchBar
              shops={searchData.shops}
              tickets={searchData.tickets}
              devices={searchData.devices}
              admins={searchData.admins}
              agents={searchData.agents}
              releases={searchData.releases}
              activations={searchData.activations}
              pricingCampaigns={searchData.pricingCampaigns}
              growthCampaigns={searchData.growthCampaigns}
              aiProviders={searchData.aiProviders}
              featureFlags={searchData.featureFlags}
              previewMode={previewMode}
              compact
            />
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {showNav ? (
          <nav className="shrink-0 border-b border-border bg-card px-2 py-2 md:hidden">
            <div className="flex gap-1 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
               {visiblePrimary.map((tab) => renderNavButton(tab, true))}
            </div>
          </nav>
        ) : null}

        {showNav ? (
           <aside className="hidden min-h-0 w-60 shrink-0 overflow-y-auto overscroll-y-contain border-r border-border bg-card md:block">
            <nav className="flex flex-col gap-1 p-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
               <p className="px-2 pb-2 pt-1 text-[10px] font-black uppercase text-muted-foreground">Operations Console</p>
               {visiblePrimary.map((tab) => renderNavButton(tab))}
            </nav>
          </aside>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-muted/90 [-webkit-overflow-scrolling:touch]">
          <div className="mx-auto w-full min-w-0 max-w-2xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:max-w-4xl xl:max-w-6xl 2xl:max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}
