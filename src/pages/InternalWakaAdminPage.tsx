import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowLeft, BarChart3, ChevronDown, Headphones, Loader2, MapPin, ShieldCheck, Store, Users, WalletCards } from "lucide-react";
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
  Icon,
  children,
}: {
  to: string;
  active: boolean;
  Icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-black transition",
        active
          ? "bg-white text-primary shadow-sm"
          : "bg-white/10 text-primary-foreground hover:bg-white/20",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}

function AdminHeaderDropdown() {
  const groups = [
    {
      title: "Overview",
      items: [
        { href: "/internal/waka#ops-pulse", label: "Live pulse", Icon: BarChart3 },
        { href: "/internal/waka#ops-plans", label: "Plans", Icon: WalletCards },
        { href: "/internal/waka#ops-districts", label: "Districts", Icon: MapPin },
        { href: "/internal/waka#ops-recent-shops", label: "Shops", Icon: Store },
      ],
    },
    {
      title: "Queues",
      items: [
        { href: "/internal/waka#ops-pending-trials", label: "Trial requests", Icon: WalletCards },
        { href: "/internal/waka#ops-annual-queue", label: "Annual payments", Icon: WalletCards },
        { href: "/internal/waka#ops-support", label: "Support", Icon: Headphones },
      ],
    },
    {
      title: "Field",
      items: [
        { href: "/internal/waka#ops-map", label: "Map", Icon: MapPin },
        { href: "/internal/waka#ops-charts", label: "Insights", Icon: BarChart3 },
        { href: "/internal/waka#ops-visits", label: "Visits", Icon: MapPin },
      ],
    },
  ];

  return (
    <details className="group relative shrink-0">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-black text-primary-foreground transition hover:bg-white/20 marker:content-none [&::-webkit-details-marker]:hidden">
        Sections
        <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 top-11 z-[90] w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl">
        {groups.map((group) => (
          <div key={group.title} className="border-b border-border p-2 last:border-b-0">
            <p className="px-2 pb-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground">{group.title}</p>
            <div className="grid grid-cols-2 gap-1">
              {group.items.map(({ href, label, Icon }) => (
                <a
                  key={href}
                  href={href}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl px-2 text-xs font-black text-foreground hover:bg-muted"
                >
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  {label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
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
      <header className="flex flex-wrap items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
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
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <AdminTab to="/internal/waka" active={active === "overview"} Icon={ShieldCheck}>
            Overview
          </AdminTab>
          <AdminTab to="/internal/waka/activations" active={active === "activations"} Icon={WalletCards}>
            Activation
          </AdminTab>
          {adminRow?.role === "super_admin" ? (
            <AdminTab to="/internal/waka/admins" active={active === "admins"} Icon={Users}>
              Admins
            </AdminTab>
          ) : null}
          <AdminHeaderDropdown />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl p-4">{children}</div>
      </main>
    </div>
  );
}
