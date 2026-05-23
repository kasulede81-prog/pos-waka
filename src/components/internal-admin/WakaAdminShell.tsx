import type { ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, MapPin, Users, CreditCard, Headphones, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { WakaInternalAdminRow } from "../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../lib/internalAdminPreview";

type TabRoute = "/internal/waka" | "/internal/waka/activations" | "/internal/waka/admins";

const TABS: { to: TabRoute; label: string; active: Props["active"]; superOnly?: boolean }[] = [
  { to: "/internal/waka", label: "Overview", active: "overview" },
  { to: "/internal/waka/activations", label: "Activations", active: "activations" },
  { to: "/internal/waka/admins", label: "Admins", active: "admins", superOnly: true },
];

const HASH_TABS: { hash: string; label: string }[] = [
  { hash: "#ops-plans", label: "Plans" },
  { hash: "#ops-districts", label: "Districts" },
  { hash: "#ops-recent-shops", label: "Shops" },
  { hash: "#ops-support", label: "Support" },
  { hash: "#ops-visits", label: "Visits" },
];

const QUICK_JUMPS = [
  { href: "#ops-support", label: "Support", Icon: Headphones },
  { href: "#ops-annual-queue", label: "Payments", Icon: CreditCard },
  { href: "#ops-map", label: "Field map", Icon: MapPin },
  { href: "#ops-recent-shops", label: "Shops", Icon: Users },
] as const;

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  loading: boolean;
  active: "overview" | "activations" | "admins" | "shop";
  activeHash?: string;
  /** Sample-data UI; no live mutations. */
  previewMode?: boolean;
  children: ReactNode;
};

export function WakaAdminShell({ lang, adminRow, loading, active, activeHash = "", previewMode = false, children }: Props) {
  if (loading) {
    return (
      <div className="fixed inset-0 z-[80] flex h-[100dvh] flex-col items-center justify-center bg-stone-100 font-admin">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
        <p className="mt-3 text-sm font-semibold text-stone-600">Loading admin…</p>
      </div>
    );
  }

  if (!adminRow && !previewMode) {
    return <Navigate to="/" replace />;
  }

  const row = adminRow!;
  const isSuper = row.role === "super_admin";
  const tabTo = (path: TabRoute) => (previewMode ? internalAdminPreviewHref(path) : path);

  return (
    <div className="fixed inset-0 z-[80] flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-stone-100 font-admin text-stone-900">
      <header className="shrink-0 bg-orange-600 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            className="rounded-full p-1.5 hover:bg-white/10"
            aria-label={t(lang, "internalAdminBack")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-tight">Waka Uganda Admin</div>
            <div className="truncate text-xs opacity-90">
              {row.full_name || row.email || "Internal team"}
            </div>
          </div>
          {previewMode ? (
            <span className="shrink-0 rounded-full bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase text-amber-950">
              {t(lang, "internalDashPreviewBadge")}
            </span>
          ) : null}
          <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold sm:inline">
            {roleLabel(row.role)}
          </span>
          <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold md:inline">
            {row.assigned_district_ids?.length ?? 0} districts
          </span>
        </div>

        {previewMode ? (
          <p className="mx-auto max-w-7xl px-4 pb-2 text-[11px] font-semibold text-white/90">
            {t(lang, "internalAdminPreviewShellHint")}
          </p>
        ) : null}

        {active === "overview" ? (
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            {QUICK_JUMPS.map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold hover:bg-white/20"
              >
                <Icon className="h-3 w-3" aria-hidden />
                {label}
              </a>
            ))}
          </div>
        ) : null}
      </header>

      <nav className="shrink-0 border-b border-stone-200 bg-white" aria-label="Admin sections">
        <div className="mx-auto flex max-w-7xl overflow-x-auto [scrollbar-width:none]">
          {TABS.filter((tab) => !tab.superOnly || isSuper).map((tab) => (
            <Link
              key={tab.to}
              to={tabTo(tab.to)}
              className={clsx(
                "whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-black transition",
                active === tab.active && (tab.active !== "overview" || !activeHash)
                  ? "border-orange-600 text-orange-700"
                  : "border-transparent text-stone-500 hover:text-stone-800",
              )}
            >
              {tab.label}
            </Link>
          ))}
          {active === "overview"
            ? HASH_TABS.map((tab) => (
                <a
                  key={tab.hash}
                  href={previewMode ? internalAdminPreviewHref(`/internal/waka${tab.hash}`) : `/internal/waka${tab.hash}`}
                  className={clsx(
                    "whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-black transition",
                    activeHash === tab.hash
                      ? "border-orange-600 text-orange-700"
                      : "border-transparent text-stone-500 hover:text-stone-800",
                  )}
                >
                  {tab.label}
                </a>
              ))
            : null}
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto bg-stone-50/80">
        <div className="mx-auto w-full max-w-7xl p-4">{children}</div>
      </main>
    </div>
  );
}
