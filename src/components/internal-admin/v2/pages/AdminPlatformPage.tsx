import { Link } from "@/lib/routerCompat";
import {
  Activity,
  BadgeDollarSign,
  Bot,
  BriefcaseBusiness,
  Building2,
  MonitorCog,
  RadioTower,
  Rocket,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tags,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { internalAdminPreviewHref } from "../../../../lib/internalAdminPreview";
import { adminPermissions } from "../adminRoles";

type PlatformItem = {
  label: string;
  description: string;
  path: string;
  icon: ReactNode;
  superOnly?: boolean;
  aiOnly?: boolean;
};

const GROUPS: Array<{ label: string; items: PlatformItem[] }> = [
  {
    label: "Revenue",
    items: [
      { label: "Billing", description: "Plans, trials, renewals and annual actions", path: "/internal/waka/billing", icon: <BadgeDollarSign /> },
      { label: "Pricing campaigns", description: "Time-bound pricing offers", path: "/internal/waka/billing/pricing-campaigns", icon: <Tags /> },
      { label: "Growth campaigns", description: "Promotional access and grants", path: "/internal/waka/growth-campaign", icon: <Sparkles /> },
    ],
  },
  {
    label: "Configuration",
    items: [
      { label: "AI settings", description: "Platform providers, limits and feature controls", path: "/internal/waka/ai-settings", icon: <Bot />, aiOnly: true },
      { label: "Subscription settings", description: "Global plan defaults", path: "/internal/waka/subscription-settings", icon: <Settings2 />, superOnly: true },
      { label: "Business types", description: "Business-type catalogue", path: "/internal/waka/business-types", icon: <Building2 />, superOnly: true },
      { label: "Display scale", description: "POS display master control", path: "/internal/waka/display-scale", icon: <MonitorCog /> },
      { label: "Remote support", description: "Master availability switch", path: "/internal/waka/remote-support", icon: <RadioTower /> },
      { label: "Releases", description: "Publish and archive app releases", path: "/internal/waka/releases", icon: <Rocket />, superOnly: true },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Internal admins", description: "Roles, districts and access status", path: "/internal/waka/admins", icon: <ShieldCheck />, superOnly: true },
      { label: "Agents", description: "Marketing and field-agent operations", path: "/internal/waka/agents", icon: <Users /> },
    ],
  },
  {
    label: "Advanced",
    items: [
      { label: "Pilot operations", description: "Cohorts, crashes, migrations and alerts", path: "/internal/waka/pilot", icon: <BriefcaseBusiness /> },
      { label: "Activations", description: "Business activation requests", path: "/internal/waka/activations", icon: <Activity /> },
      { label: "Growth analytics", description: "Existing operational trends", path: "/internal/waka/analytics", icon: <Activity /> },
    ],
  },
];

export function AdminPlatformPage({ adminRow, previewMode }: { adminRow: WakaInternalAdminRow | null; previewMode: boolean }) {
  const perms = adminPermissions(adminRow);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-black uppercase text-waka-500">WAKA Operations</p>
        <h1 className="mt-1 text-2xl font-black text-foreground">Platform</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Global commercial, configuration, people and specialist controls. Customer interventions remain in each Customer Workspace.
        </p>
      </header>

      {GROUPS.map((group) => {
        const items = group.items.filter((item) => {
          if (item.superOnly && perms.role !== "super_admin") return false;
          if (item.aiOnly && !perms.canManageAi) return false;
          return true;
        });
        if (!items.length) return null;
        return (
          <section key={group.label} aria-labelledby={`platform-${group.label.toLowerCase()}`}>
            <h2 id={`platform-${group.label.toLowerCase()}`} className="mb-2 text-xs font-black uppercase text-muted-foreground">
              {group.label}
            </h2>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <Link
                  key={item.path}
                  to={previewMode ? internalAdminPreviewHref(item.path) : item.path}
                  className="group flex min-h-24 items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition hover:border-waka-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-waka-500/10 text-waka-500 [&>svg]:size-4" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-foreground group-hover:text-waka-500">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}