import type { ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { WakaInternalAdminRow } from "../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../lib/internalAdminPreview";

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

  const handleBack = () => {
    if (active === "shop") {
      navigate(previewMode ? internalAdminPreviewHref("/internal/waka") : "/internal/waka");
      return;
    }
    if (active !== "overview") {
      navigate(tabTo("/internal/waka"));
    }
  };

  const showBack = active !== "overview";

  return (
    <div className="fixed inset-0 z-[80] flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-stone-100 font-admin text-stone-900">
      <header className="shrink-0 bg-orange-600 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          {showBack ? (
            <button
              type="button"
              onClick={handleBack}
              className="rounded-full p-1.5 hover:bg-white/10"
              aria-label={t(lang, "internalAdminBack")}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="w-8" aria-hidden />
          )}
          <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="block text-lg font-black leading-tight">Waka Uganda Admin</span>
            <span className="block truncate text-xs opacity-90">{row.full_name || row.email || "Internal team"}</span>
          </p>
          {previewMode ? (
            <span className="shrink-0 rounded-full bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase text-amber-950">
              {t(lang, "internalDashPreviewBadge")}
            </span>
          ) : null}
          <Link
            to="/office"
            className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25"
          >
            {t(lang, "internalAdminExitOffice")}
          </Link>
        </div>
      </header>

      <nav className="shrink-0 border-b border-stone-200 bg-white" aria-label="Admin sections">
        <div className="mx-auto flex max-w-7xl overflow-x-auto [scrollbar-width:none]">
          {TABS.filter((tab) => !tab.superOnly || isSuper).map((tab) => (
            <Link
              key={tab.to}
              to={tabTo(tab.to)}
              className={clsx(
                "whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-black transition",
                active === tab.active ? "border-orange-600 text-orange-700" : "border-transparent text-stone-500 hover:text-stone-800",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto bg-stone-50/80">
        <div className="mx-auto w-full max-w-7xl p-4">{children}</div>
      </main>
    </div>
  );
}
