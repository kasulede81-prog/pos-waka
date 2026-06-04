import { useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { WakaSymbolIcon } from "../../brand/WakaLogo";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { WakaInternalAdminRow } from "../../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../../lib/internalAdminPreview";

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
  | "analytics"
  | "activations"
  | "admins"
  | "pilot"
  | "business_types"
  | "shop";

type TabDef = {
  id: AdminSectionId;
  path: string;
  label: string;
  superOnly?: boolean;
};

const TABS: TabDef[] = [
  { id: "overview", path: "/internal/waka", label: "Ops" },
  { id: "shops", path: "/internal/waka/shops", label: "Shops" },
  { id: "devices", path: "/internal/waka/devices", label: "Devices" },
  { id: "support", path: "/internal/waka/support", label: "Support" },
  { id: "pilot", path: "/internal/waka/pilot", label: "Pilot" },
  { id: "billing", path: "/internal/waka/billing", label: "Billing" },
  { id: "analytics", path: "/internal/waka/analytics", label: "Growth" },
  { id: "agents", path: "/internal/waka/agents", label: "Agents" },
  { id: "activations", path: "/internal/waka/activations", label: "Keys" },
  { id: "admins", path: "/internal/waka/admins", label: "Admins", superOnly: true },
  { id: "business_types", path: "/internal/waka/business-types", label: "Biz types", superOnly: true },
];

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  loading: boolean;
  active: AdminSectionId;
  previewMode?: boolean;
  children: ReactNode;
};

export function AdminShell({ lang, adminRow, loading, active, previewMode = false, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  useLockUnderlyingAppScroll(true);

  const isSuper = adminRow?.role === "super_admin";
  const tabTo = (path: string) => (previewMode ? internalAdminPreviewHref(path) : path);

  const visibleTabs = useMemo(() => TABS.filter((tab) => !tab.superOnly || isSuper), [isSuper]);

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
  const roleLabel = (row.role ?? "admin").replace(/_/g, " ");
  const showNav = active !== "shop";
  const showBack = active === "shop";

  const currentPath = location.pathname + location.search;

  return createPortal(
    <div className="waka-internal-admin-root fixed inset-0 flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-stone-100 font-admin text-stone-900">
      <header className="shrink-0 bg-gradient-to-r from-orange-600 to-orange-500 text-white shadow-md">
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
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white p-1.5 shadow-sm" aria-hidden>
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
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {showNav ? (
          <nav className="shrink-0 border-b border-stone-200 bg-white px-2 py-2 lg:hidden">
            <div className="flex gap-1 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
              {visibleTabs.map((tab) => {
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
                      "shrink-0 rounded-xl px-3 py-2.5 text-xs font-black transition min-h-[44px]",
                      isActive ? "bg-orange-600 text-white shadow-sm" : "bg-stone-100 text-stone-700",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>
        ) : null}

        {showNav ? (
          <aside className="hidden min-h-0 w-52 shrink-0 border-r border-stone-200 bg-white lg:block">
            <nav className="flex flex-col gap-0.5 p-3">
              {visibleTabs.map((tab) => {
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
                      "rounded-xl px-3 py-2.5 text-left text-sm font-bold transition min-h-[44px]",
                      isActive ? "bg-orange-50 text-orange-800 ring-1 ring-orange-200" : "text-stone-600 hover:bg-stone-50",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </aside>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-stone-50/90 [-webkit-overflow-scrolling:touch]">
          <div className="mx-auto w-full max-w-2xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:max-w-3xl">{children}</div>
        </main>
      </div>
    </div>,
    document.body,
  );
}
