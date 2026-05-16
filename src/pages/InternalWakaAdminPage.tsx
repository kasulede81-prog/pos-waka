import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowLeft, Loader2, ShieldCheck, Users, WalletCards } from "lucide-react";
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

function AdminTab({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "flex-1 whitespace-nowrap border-b-2 px-3 py-3 text-center text-xs font-black transition",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function InternalWakaAdminPage({ lang, email }: Props) {
  const [loading, setLoading] = useState(true);
  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const location = useLocation();
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
    <InternalAdminShell lang={lang} email={email} adminRow={adminRow} active="overview">
      <InternalOpsDashboard lang={lang} email={email} adminRow={adminRow} previewMode={false} />
    </InternalAdminShell>
  );
}

function InternalAdminShell({
  lang,
  email,
  adminRow,
  active,
  children,
}: {
  lang: Language;
  email: string | null | undefined;
  adminRow: WakaInternalAdminRow | null;
  active: "overview" | "activations" | "admins";
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex h-[100dvh] flex-col overflow-hidden bg-muted/50 font-admin text-foreground">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <Link
          to="/"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-primary-foreground transition hover:bg-white/25"
          aria-label={t(lang, "internalAdminBack")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black">Waka Uganda Admin</p>
          <p className="truncate text-[11px] font-medium text-primary-foreground/80">
            {adminRow?.full_name || email || adminRow?.email || "Internal team"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide">
          {adminRow?.role?.replace(/_/g, " ") ?? "admin"}
        </span>
      </header>

      <nav className="w-full shrink-0 overflow-x-auto rounded-none border-b border-border bg-card">
        <div className="flex min-w-max">
          <AdminTab to="/internal/waka" active={active === "overview"}>
            <span className="inline-flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Overview
            </span>
          </AdminTab>
          <AdminTab to="/internal/waka/activations" active={active === "activations"}>
            <span className="inline-flex items-center justify-center gap-1.5">
              <WalletCards className="h-3.5 w-3.5" />
              Activations
            </span>
          </AdminTab>
          {adminRow?.role === "super_admin" ? (
            <AdminTab to="/internal/waka/admins" active={active === "admins"}>
              <span className="inline-flex items-center justify-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Admins
              </span>
            </AdminTab>
          ) : null}
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-4">{children}</div>
      </main>
    </div>
  );
}
