import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowLeft, Headphones, Loader2, MapPin, ShieldCheck, Store, WalletCards } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { fetchWakaInternalAdminMe, type WakaInternalAdminRow } from "../lib/wakaInternalAdmin";
import { InternalOpsDashboard } from "../components/internal-admin/InternalOpsDashboard";
import { InternalAdminsManagement } from "../components/internal-admin/InternalAdminsManagement";
import { InternalActivationOpsPage } from "./InternalActivationOpsPage";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

function AdminQuickTool({
  href,
  Icon,
  children,
}: {
  href: string;
  Icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-muted px-3 text-xs font-black text-foreground ring-1 ring-border active:bg-primary/10"
    >
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </a>
  );
}

function AdminSectionTab({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={clsx(
        "inline-flex h-10 shrink-0 items-center justify-center border-b-2 px-3 text-xs font-black transition",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground active:text-foreground",
      )}
    >
      {children}
    </a>
  );
}

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const location = useLocation();
  const activeHash = location.hash;
  const isAdminsRoute = location.pathname === "/internal/waka/admins";
  const isActivationsRoute = location.pathname === "/internal/waka/activations";
  const canEnterUi = Boolean(adminRow);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const row = await fetchWakaInternalAdminMe();
      if (cancelled) return;
      setAdminRow(row);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[80] flex h-[100dvh] flex-col overflow-hidden bg-muted/50 font-admin text-foreground">
        <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">Waka Uganda Admin</p>
            <p className="truncate text-[11px] font-medium text-primary-foreground/80">{email ?? "Loading admin access"}</p>
          </div>
          <Loader2 className="h-4 w-4 animate-spin" />
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="h-56 animate-pulse rounded-xl border border-border bg-card lg:col-span-2" />
            <div className="h-56 animate-pulse rounded-xl border border-border bg-card" />
          </div>
        </div>
      </div>
    );
  }

  if (!canEnterUi) {
    return <Navigate to="/" replace />;
  }

  if (isActivationsRoute) {
    return (
      <InternalAdminShell lang={lang} email={email} adminRow={adminRow} active="activations">
        <InternalActivationOpsPage lang={lang} />
      </InternalAdminShell>
    );
  }

  if (isAdminsRoute) {
    if (adminRow?.role !== "super_admin") {
      return (
        <InternalAdminShell lang={lang} email={email} adminRow={adminRow} active="admins">
          <div className="rounded-xl border border-destructive/25 bg-card p-4 text-center text-sm font-bold text-destructive">
            {t(lang, "internalAdminsSuperOnly")}
          </div>
        </InternalAdminShell>
      );
    }
    return (
      <InternalAdminShell lang={lang} email={email} adminRow={adminRow} active="admins">
        <InternalAdminsManagement lang={lang} />
      </InternalAdminShell>
    );
  }

  return (
    <InternalAdminShell lang={lang} email={email} adminRow={adminRow} active="overview" activeHash={activeHash}>
      <InternalOpsDashboard lang={lang} email={email} adminRow={adminRow} previewMode={false} />
    </InternalAdminShell>
  );
}

function InternalAdminShell({
  lang,
  email,
  adminRow,
  active,
  activeHash = "",
  children,
}: {
  lang: Language;
  email: string | null | undefined;
  adminRow: WakaInternalAdminRow | null;
  active: "overview" | "activations" | "admins";
  activeHash?: string;
  children: React.ReactNode;
}) {
  const canManageAdmins = adminRow?.role === "super_admin";
  const routeTabActive = (route: typeof active) => active === route && (route !== "overview" || !activeHash);
  const hashTabActive = (hash: string) => active === "overview" && activeHash === hash;

  return (
    <div className="fixed inset-0 z-[80] flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-muted/50 font-admin text-foreground">
      <header className="flex shrink-0 items-center gap-2 bg-primary px-3 py-2.5 text-primary-foreground sm:gap-3 sm:px-4 sm:py-3">
        <Link
          to="/"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-primary-foreground transition hover:bg-white/25"
          aria-label={t(lang, "internalAdminBack")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 min-[380px]:flex">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black">Waka Uganda Admin</p>
          <p className="truncate text-[11px] font-medium text-primary-foreground/80">
            {adminRow?.full_name || email || adminRow?.email || "Internal team"}
          </p>
        </div>
        <span className="max-w-[34vw] shrink-0 truncate rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide sm:max-w-none">
          {adminRow?.role?.replace(/_/g, " ") ?? "admin"}
        </span>
      </header>

      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex max-w-full items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-muted-foreground">Quick tools:</span>
          <AdminQuickTool href="/internal/waka#ops-support" Icon={Headphones}>
            Support
          </AdminQuickTool>
          <AdminQuickTool href="/internal/waka#ops-annual-queue" Icon={WalletCards}>
            Payments
          </AdminQuickTool>
          <AdminQuickTool href="/internal/waka#ops-map" Icon={MapPin}>
            Field map
          </AdminQuickTool>
          <AdminQuickTool href="/internal/waka#ops-recent-shops" Icon={Store}>
            Shops
          </AdminQuickTool>
        </div>
      </div>

      <nav className="shrink-0 border-b border-border bg-card" aria-label="Admin sections">
        <div className="flex max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <AdminSectionTab href="/internal/waka" active={routeTabActive("overview")}>
            Overview
          </AdminSectionTab>
          <AdminSectionTab href="/internal/waka/activations" active={routeTabActive("activations")}>
            Activations
          </AdminSectionTab>
          {canManageAdmins ? (
            <AdminSectionTab href="/internal/waka/admins" active={routeTabActive("admins")}>
              Admins
            </AdminSectionTab>
          ) : null}
          <AdminSectionTab href="/internal/waka#ops-plans" active={hashTabActive("#ops-plans")}>Plans</AdminSectionTab>
          <AdminSectionTab href="/internal/waka#ops-districts" active={hashTabActive("#ops-districts")}>Districts</AdminSectionTab>
          <AdminSectionTab href="/internal/waka#ops-recent-shops" active={hashTabActive("#ops-recent-shops")}>Shops</AdminSectionTab>
          <AdminSectionTab href="/internal/waka#ops-support" active={hashTabActive("#ops-support")}>Support</AdminSectionTab>
          <AdminSectionTab href="/internal/waka#ops-visits" active={hashTabActive("#ops-visits")}>Visits</AdminSectionTab>
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-3 sm:p-4">{children}</div>
      </main>
    </div>
  );
}
