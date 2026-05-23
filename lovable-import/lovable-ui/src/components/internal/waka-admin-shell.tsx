import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck, MapPin, Users, CreditCard, LifeBuoy } from "lucide-react";
import { useWakaInternalMe, roleLabel } from "@/lib/waka-admin";

const tabs: { to: "/internal/waka" | "/internal/waka/activations" | "/internal/waka/admins"; label: string; superOnly?: boolean }[] = [
  { to: "/internal/waka", label: "Overview" },
  { to: "/internal/waka/activations", label: "Activations" },
  { to: "/internal/waka/admins", label: "Admins", superOnly: true },
];

const quickJumps = [
  { href: "#ops-support", label: "Support", Icon: LifeBuoy },
  { href: "#ops-annual-queue", label: "Payments", Icon: CreditCard },
  { href: "#ops-map", label: "Field map", Icon: MapPin },
  { href: "#ops-recent-shops", label: "Shops", Icon: Users },
];

export function WakaAdminShell({ children, activeTab }: { children: ReactNode; activeTab: string }) {
  const { me, loading } = useWakaInternalMe();
  const navigate = useNavigate();

  if (loading) {
    return <div className="fixed inset-0 z-[90] grid place-items-center bg-background">Loading admin…</div>;
  }
  if (!me) {
    // Redirect non-admins to home
    void navigate({ to: "/" });
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background">
      <header className="z-[90] bg-orange-600 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/" className="rounded-full p-1.5 hover:bg-white/10" aria-label="Back to POS">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <ShieldCheck className="h-6 w-6" />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-tight">Waka Uganda Admin</div>
            <div className="truncate text-xs opacity-90">{me.full_name || me.email}</div>
          </div>
          <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold sm:inline">
            {roleLabel(me.role)}
          </span>
          <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold md:inline">
            {me.assigned_districts.length} districts
          </span>
        </div>
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {tabs.filter((t) => !t.superOnly || me.role === "super_admin").map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className={`whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-bold ${
                activeTab === t.to ? "bg-background text-orange-700" : "text-white/90 hover:bg-white/10"
              }`}
            >
              {t.label}
            </Link>
          ))}
          <div className="mx-2 h-5 w-px bg-white/30" />
          {quickJumps.map(({ href, label, Icon }) => (
            <a key={href} href={href} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold hover:bg-white/20">
              <Icon className="h-3 w-3" /> {label}
            </a>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-muted/30">
        <div className="mx-auto w-full max-w-7xl p-4">{children}</div>
      </main>
    </div>
  );
}
