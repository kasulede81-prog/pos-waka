import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { EnterpriseSpinner } from "../../enterprise/EnterpriseSpinner";
import { WakaSymbolIcon } from "../../brand/WakaLogo";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { WakaInternalAdminRow } from "../../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../../lib/internalAdminPreview";
import { useAdminGlobalSearchData } from "../../../hooks/useAdminGlobalSearchData";
import { GlobalSearchBar } from "./ops/OpsWidgets";
import {
  persistAdminNavGroupExpanded,
  readAdminNavGroupsExpanded,
  type AdminNavGroupId,
} from "../../../lib/adminNavState";
import { themeUi } from "../../../lib/themeTokens";

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
  | "shop";

type TabDef = {
  id: AdminSectionId;
  path: string;
  label: string;
  superOnly?: boolean;
};

type NavGroup = {
  id: AdminNavGroupId;
  label: string;
  tabs: TabDef[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    tabs: [
      { id: "overview", path: "/internal/waka", label: "Dashboard" },
      { id: "shops", path: "/internal/waka/shops", label: "Shops" },
      { id: "support", path: "/internal/waka/support", label: "Support" },
      { id: "devices", path: "/internal/waka/devices", label: "Devices" },
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    tabs: [
      { id: "billing", path: "/internal/waka/billing", label: "Billing" },
      { id: "pricing_campaigns", path: "/internal/waka/billing/pricing-campaigns", label: "Pricing" },
      { id: "analytics", path: "/internal/waka/analytics", label: "Growth" },
      { id: "growth_campaign", path: "/internal/waka/growth-campaign", label: "Campaigns" },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    tabs: [
      { id: "ai_settings", path: "/internal/waka/ai-settings", label: "AI", superOnly: true },
      { id: "subscription_settings", path: "/internal/waka/subscription-settings", label: "Subscriptions", superOnly: true },
      { id: "releases", path: "/internal/waka/releases", label: "Releases", superOnly: true },
      { id: "business_types", path: "/internal/waka/business-types", label: "Business Types", superOnly: true },
      { id: "display_scale", path: "/internal/waka/display-scale", label: "Display" },
    ],
  },
  {
    id: "people",
    label: "People",
    tabs: [
      { id: "admins", path: "/internal/waka/admins", label: "Internal Admins", superOnly: true },
      { id: "agents", path: "/internal/waka/agents", label: "Marketing Agents" },
    ],
  },
  {
    id: "system",
    label: "System",
    tabs: [
      { id: "activations", path: "/internal/waka/activations", label: "Activations" },
      { id: "pilot", path: "/internal/waka/pilot", label: "Pilot" },
    ],
  },
];

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  loading: boolean;
  active: AdminSectionId;
  previewMode?: boolean;
  children: ReactNode;
};

function filterTabs(tabs: TabDef[], isSuper: boolean): TabDef[] {
  return tabs.filter((tab) => !tab.superOnly || isSuper);
}

export function AdminShell({ lang, adminRow, loading, active, previewMode = false, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  useLockUnderlyingAppScroll(true);
  const searchData = useAdminGlobalSearchData(previewMode);

  const isSuper = adminRow?.role === "super_admin";
  const tabTo = (path: string) => (previewMode ? internalAdminPreviewHref(path) : path);

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({ ...g, tabs: filterTabs(g.tabs, isSuper) })).filter((g) => g.tabs.length > 0),
    [isSuper],
  );

  const [expandedGroups, setExpandedGroups] = useState(readAdminNavGroupsExpanded);

  const toggleGroup = (groupId: AdminNavGroupId) => {
    setExpandedGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      persistAdminNavGroupExpanded(groupId, next[groupId]!);
      return next;
    });
  };

  useEffect(() => {
    for (const group of visibleGroups) {
      if (group.tabs.some((tab) => tab.id === active)) {
        setExpandedGroups((prev) => {
          if (prev[group.id]) return prev;
          const next = { ...prev, [group.id]: true };
          persistAdminNavGroupExpanded(group.id, true);
          return next;
        });
      }
    }
  }, [active, visibleGroups]);

  if (loading) {
    return createPortal(
      <div className={clsx("waka-internal-admin-root fixed inset-0 flex h-[100dvh] flex-col items-center justify-center font-admin", themeUi.adminPage)}>
        <EnterpriseSpinner size="lg" label="Loading admin" className="text-waka-600" />
        <p className="mt-3 text-sm font-semibold text-muted-foreground">Loading admin…</p>
      </div>,
      document.body,
    );
  }

  if (!adminRow && !previewMode) {
    return <Navigate to="/" replace />;
  }

  const row = adminRow!;
  const roleLabel = (row.role ?? "admin").replace(/_/g, " ");
  const showNav = active !== "shop";
  const showBack = active === "shop";
  const currentPath = location.pathname + location.search;

  const flatMobileTabs = visibleGroups.flatMap((g) => g.tabs);

  const renderNavButton = (tab: TabDef, compact?: boolean) => {
    const href = tabTo(tab.path);
    const isActive = active === tab.id;
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
        {tab.label}
      </button>
    );
  };

  return createPortal(
    <div className={clsx("waka-internal-admin-root fixed inset-0 flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden font-admin", themeUi.adminPage)}>
      <header className="shrink-0 bg-gradient-to-r from-waka-600 to-waka-500 text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:px-4">
          {showBack ? (
            <button
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
            <p className="truncate text-base font-black leading-tight">{row.full_name || "Waka Admin"}</p>
            <p className="truncate text-[11px] opacity-90">
              {roleLabel} · {row.assigned_district_ids?.length ?? 0} districts
            </p>
          </div>
          {previewMode ? (
            <span className="hidden shrink-0 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black uppercase text-amber-950 sm:inline">
              Preview
            </span>
          ) : null}
          <Link
            to="/office"
            className="shrink-0 rounded-2xl bg-white/15 px-3 py-2 text-[11px] font-bold hover:bg-white/25"
          >
            {t(lang, "internalAdminExitOffice")}
          </Link>
        </div>
        {showNav ? (
          <div className="border-t border-white/15 px-3 pb-3 pt-2 sm:px-4">
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
              {flatMobileTabs.map((tab) => renderNavButton(tab, true))}
            </div>
          </nav>
        ) : null}

        {showNav ? (
          <aside className="hidden min-h-0 w-52 shrink-0 overflow-y-auto overscroll-y-contain border-r border-border bg-card md:block xl:w-56">
            <nav className="flex flex-col gap-1 p-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {visibleGroups.map((group) => {
                const expanded = expandedGroups[group.id];
                return (
                  <div key={group.id} className="mb-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      className="flex min-h-[36px] w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:bg-muted"
                    >
                      {group.label}
                      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    {expanded ? (
                      <div className="mt-0.5 flex flex-col gap-0.5 pl-1">{group.tabs.map((tab) => renderNavButton(tab))}</div>
                    ) : null}
                  </div>
                );
              })}
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
