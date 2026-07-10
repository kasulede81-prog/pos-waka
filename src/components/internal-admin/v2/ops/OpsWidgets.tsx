import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Search, ShieldAlert } from "lucide-react";
import type { OpsActivationRow } from "../../../../lib/businessActivation";
import type { AppReleaseSummary } from "../../../../lib/releaseManagementAdmin";
import type { PricingCampaign } from "../../../../lib/pricingCampaignsAdmin";
import type { GrowthCampaign } from "../../../../lib/growthCampaigns";
import type {
  AiProviderSearchRow,
  FeatureFlagSearchRow,
} from "../../../../hooks/useAdminGlobalSearchData";
import type {
  FleetDeviceRow,
  InternalAdminRow,
  RecentShopRow,
  SupportTicketRow,
} from "../../../../lib/wakaInternalAdmin";
import { formatDisplayEmail, formatOwnerDisplayLabel } from "../../../../lib/wakaInternalAdmin";
import { internalAdminShopHref, internalAdminShopTabHref } from "../../../../lib/internalAdminPreview";
import {
  CURRENT_APP_VERSION,
  deviceOnline,
  healthColor,
  tagLabel,
  type OpsFeedEvent,
  type ShopHealth,
  type SystemHealthSnapshot,
  type SupportTag,
} from "../../../../lib/internalOpsIntelligence";
import {
  createAnnouncement,
  listAnnouncements,
  type OpsAnnouncement,
} from "../../../../lib/internalOpsLocal";
import { addShopInternalNote, fetchShopInternalNotes, type SharedInternalNote } from "../../../../lib/internalOpsHardening";
import { executeInternalAdminAction } from "../../../../lib/internalAdminActionRunner";
import { t } from "../../../../lib/i18n";
import type { Language } from "../../../../types";
import { BottomSheet } from "../primitives";

const STATUS_STYLES = {
  healthy: "bg-emerald-500 shadow-emerald-500/40",
  warning: "bg-amber-500 shadow-amber-500/40",
  critical: "bg-rose-500 shadow-rose-500/40 animate-pulse",
};

export function SystemStatusCenter({ health }: { health: SystemHealthSnapshot }) {
  const items = [
    { label: "Devices online (15m)", value: health.activeDevices },
    { label: "Shops online now", value: health.shopsOnline },
    { label: "Active today", value: health.shopsActiveToday },
    { label: "Offline now", value: health.offlineShops },
    { label: "Sync issues", value: health.failedSyncs },
    { label: "Queue load", value: health.queueDelays },
    { label: "Open support", value: health.openSupport },
  ];

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-gradient-to-br from-stone-900 via-stone-800 to-waka-950 p-4 text-white shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-waka-200/90">Mission control</p>
          <h2 className="mt-1 text-lg font-black">System status</h2>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5">
          <span className={clsx("h-2.5 w-2.5 rounded-full shadow", STATUS_STYLES[health.status])} />
          <span className="text-xs font-black">{health.label}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl bg-white/10 px-2.5 py-2 backdrop-blur-sm">
            <p className="text-[10px] font-bold uppercase text-white/70">{it.label}</p>
            <p className="font-mono text-lg font-black">{it.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-white/75">
        App adoption · {health.appVersionTop} on {health.appVersionShare}% of tracked devices · target {CURRENT_APP_VERSION}
      </p>
    </section>
  );
}

export function ActivityFeedPanel({ events, previewMode }: { events: OpsFeedEvent[]; previewMode: boolean }) {
  const [filter, setFilter] = useState<"all" | "high">("all");
  const list = filter === "high" ? events.filter((e) => e.priority === "high") : events;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black text-stone-900">Live activity</h2>
        <div className="flex gap-1">
          {(["all", "high"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded-full px-2.5 py-1 text-[10px] font-black uppercase",
                filter === f ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-600",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {list.length === 0 ? (
          <li className="py-6 text-center text-sm font-semibold text-stone-500">No events right now.</li>
        ) : (
          list.map((e) => (
            <motion.li
              key={e.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={clsx(
                "rounded-xl border px-3 py-2.5 text-sm",
                e.priority === "high" ? "border-rose-200 bg-rose-50/80" : "border-stone-100 bg-stone-50/60",
              )}
            >
              <p className="text-[10px] font-bold text-stone-500">{e.timeLabel}</p>
              <p className="font-semibold text-stone-900">{e.message}</p>
              {e.shopId ? (
                <Link
                  to={internalAdminShopHref(e.shopId, previewMode)}
                  className="mt-1 inline-block text-[11px] font-black text-waka-600"
                >
                  Open shop →
                </Link>
              ) : null}
            </motion.li>
          ))
        )}
      </ul>
    </section>
  );
}

export function HealthBadge({ health }: { health: ShopHealth }) {
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black", healthColor(health.level))}>
      {health.score}%
    </span>
  );
}

export function SupportTagsRow({ tags }: { tags: SupportTag[] }) {
  if (!tags.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.slice(0, 4).map((t) => (
        <span key={t} className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-stone-600">
          {tagLabel(t)}
        </span>
      ))}
    </div>
  );
}

export function GlobalSearchBar({
  shops,
  tickets,
  devices = [],
  admins = [],
  agents = [],
  releases = [],
  activations = [],
  pricingCampaigns = [],
  growthCampaigns = [],
  aiProviders = [],
  featureFlags = [],
  previewMode,
  compact = false,
}: {
  shops: RecentShopRow[];
  tickets: SupportTicketRow[];
  devices?: FleetDeviceRow[];
  admins?: InternalAdminRow[];
  agents?: { id: string; full_name: string | null; email: string | null; phone_e164: string | null }[];
  releases?: AppReleaseSummary[];
  activations?: OpsActivationRow[];
  pricingCampaigns?: PricingCampaign[];
  growthCampaigns?: GrowthCampaign[];
  aiProviders?: AiProviderSearchRow[];
  featureFlags?: FeatureFlagSearchRow[];
  previewMode: boolean;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  type Hit =
    | { type: "shop"; id: string; label: string; sub: string }
    | { type: "ticket"; id: string; label: string; sub: string; shopId?: string | null }
    | { type: "device"; id: string; label: string; sub: string; shopId: string }
    | { type: "admin"; id: string; label: string; sub: string }
    | { type: "agent"; id: string; label: string; sub: string }
    | { type: "release"; id: string; label: string; sub: string }
    | { type: "activation"; id: string; label: string; sub: string }
    | { type: "pricing_campaign"; id: string; label: string; sub: string }
    | { type: "growth_campaign"; id: string; label: string; sub: string }
    | { type: "ai_provider"; id: string; label: string; sub: string }
    | { type: "feature_flag"; id: string; label: string; sub: string; path: string };

  const results = useMemo((): Hit[] => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];

    const shopHits = shops
      .filter((s) => {
        const owner =
          formatDisplayEmail(s.owner_email) ??
          formatOwnerDisplayLabel({ ownerFullName: s.owner_full_name, ownerLabel: s.owner_label }) ??
          "";
        return (
          s.name.toLowerCase().includes(needle) ||
          (s.shop_number ?? "").toLowerCase().includes(needle) ||
          owner.toLowerCase().includes(needle) ||
          (s.district ?? "").toLowerCase().includes(needle) ||
          (s.phone_e164 ?? "").includes(needle)
        );
      })
      .slice(0, 5)
      .map(
        (s): Hit => ({
          type: "shop",
          id: s.id,
          label: s.shop_number ? `${s.shop_number} · ${s.name}` : s.name,
          sub: s.district ?? "Shop",
        }),
      );

    const ticketHits = tickets
      .filter(
        (t) =>
          (t.shop_name ?? "").toLowerCase().includes(needle) ||
          (t.subject ?? "").toLowerCase().includes(needle) ||
          (t.owner_email ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 4)
      .map(
        (t): Hit => ({
          type: "ticket",
          id: t.id,
          shopId: t.shop_id,
          label: t.shop_name ?? t.subject ?? "Ticket",
          sub: t.issue_type ?? t.status,
        }),
      );

    const deviceHits = devices
      .filter(
        (d) =>
          (d.label ?? "").toLowerCase().includes(needle) ||
          d.device_fingerprint.toLowerCase().includes(needle) ||
          (d.shop_name ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 4)
      .map(
        (d): Hit => ({
          type: "device",
          id: d.id,
          shopId: d.shop_id,
          label: d.label || d.device_fingerprint.slice(0, 16),
          sub: d.shop_name ?? "Device",
        }),
      );

    const adminHits = admins
      .filter(
        (a) =>
          (a.email ?? "").toLowerCase().includes(needle) ||
          (a.full_name ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 3)
      .map(
        (a): Hit => ({
          type: "admin",
          id: a.id,
          label: a.full_name || a.email || "Admin",
          sub: a.role.replace(/_/g, " "),
        }),
      );

    const agentHits = agents
      .filter(
        (a) =>
          (a.email ?? "").toLowerCase().includes(needle) ||
          (a.full_name ?? "").toLowerCase().includes(needle) ||
          (a.phone_e164 ?? "").includes(needle),
      )
      .slice(0, 3)
      .map(
        (a): Hit => ({
          type: "agent",
          id: a.id,
          label: a.full_name || a.email || "Agent",
          sub: a.phone_e164 ?? "Marketing agent",
        }),
      );

    const releaseHits = releases
      .filter(
        (r) =>
          (r.versionNumber ?? "").toLowerCase().includes(needle) ||
          (r.releaseName ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 3)
      .map(
        (r): Hit => ({
          type: "release",
          id: r.id,
          label: `v${r.versionNumber} · ${r.releaseName}`,
          sub: r.status,
        }),
      );

    const activationHits = activations
      .filter(
        (a) =>
          (a.public_reference_code ?? "").toLowerCase().includes(needle) ||
          (a.business_display_name ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 3)
      .map(
        (a): Hit => ({
          type: "activation",
          id: a.id,
          label: a.business_display_name || a.public_reference_code || "Activation",
          sub: a.public_reference_code ?? a.status,
        }),
      );

    const pricingHits = pricingCampaigns
      .filter((c) => c.name.toLowerCase().includes(needle) || (c.description ?? "").toLowerCase().includes(needle))
      .slice(0, 3)
      .map(
        (c): Hit => ({
          type: "pricing_campaign",
          id: c.id,
          label: c.name,
          sub: c.enabled ? "Active pricing campaign" : "Pricing campaign",
        }),
      );

    const growthHits = growthCampaigns
      .filter((c) => c.name.toLowerCase().includes(needle) || (c.description ?? "").toLowerCase().includes(needle))
      .slice(0, 3)
      .map(
        (c): Hit => ({
          type: "growth_campaign",
          id: c.id,
          label: c.name,
          sub: c.enabled ? "Growth campaign" : "Campaign (disabled)",
        }),
      );

    const aiHits = aiProviders
      .filter((p) => p.label.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle))
      .slice(0, 3)
      .map(
        (p): Hit => ({
          type: "ai_provider",
          id: p.id,
          label: p.label,
          sub: "AI provider",
        }),
      );

    const flagHits = featureFlags
      .filter((f) => f.label.toLowerCase().includes(needle) || f.id.toLowerCase().includes(needle))
      .slice(0, 3)
      .map(
        (f): Hit => ({
          type: "feature_flag",
          id: f.id,
          label: f.label,
          sub: "Feature flag",
          path: f.path,
        }),
      );

    return [
      ...shopHits,
      ...ticketHits,
      ...deviceHits,
      ...adminHits,
      ...agentHits,
      ...releaseHits,
      ...activationHits,
      ...pricingHits,
      ...growthHits,
      ...aiHits,
      ...flagHits,
    ];
  }, [q, shops, tickets, devices, admins, agents, releases, activations, pricingCampaigns, growthCampaigns, aiProviders, featureFlags]);

  const go = (r: Hit) => {
    setOpen(false);
    setQ("");
    switch (r.type) {
      case "shop":
        navigate(internalAdminShopHref(r.id, previewMode));
        break;
      case "ticket":
        if (r.shopId) navigate(internalAdminShopTabHref(r.shopId, "support", previewMode));
        else navigate(previewMode ? "/internal/waka/support?preview=1" : "/internal/waka/support");
        break;
      case "device":
        navigate(internalAdminShopTabHref(r.shopId, "devices", previewMode));
        break;
      case "admin":
        navigate(previewMode ? "/internal/waka/admins?preview=1" : "/internal/waka/admins");
        break;
      case "agent":
        navigate(previewMode ? "/internal/waka/agents?preview=1" : "/internal/waka/agents");
        break;
      case "release":
        navigate(previewMode ? "/internal/waka/releases?preview=1" : "/internal/waka/releases");
        break;
      case "activation":
        navigate(previewMode ? "/internal/waka/activations?preview=1" : "/internal/waka/activations");
        break;
      case "pricing_campaign":
        navigate(
          previewMode
            ? "/internal/waka/billing/pricing-campaigns?preview=1"
            : "/internal/waka/billing/pricing-campaigns",
        );
        break;
      case "growth_campaign":
        navigate(previewMode ? "/internal/waka/growth-campaign?preview=1" : "/internal/waka/growth-campaign");
        break;
      case "ai_provider":
        navigate(previewMode ? "/internal/waka/ai-settings?preview=1" : "/internal/waka/ai-settings");
        break;
      case "feature_flag":
        navigate(previewMode ? `${r.path}?preview=1` : r.path);
        break;
    }
  };

  return (
    <div className="relative">
      <div
        className={clsx(
          "flex items-center gap-2 rounded-2xl border px-3 shadow-sm",
          compact ? "border-white/25 bg-white/10" : "border-stone-200 bg-white",
        )}
      >
        <Search className={clsx("h-4 w-4 shrink-0", compact ? "text-white/70" : "text-stone-400")} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Search shops, campaigns, devices, tickets…"
          className={clsx(
            "min-h-[40px] flex-1 bg-transparent text-sm font-semibold outline-none",
            compact ? "text-white placeholder:text-white/60" : "text-stone-900",
          )}
        />
      </div>
      {open && q.length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-stone-200 bg-white py-1 shadow-xl">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-stone-500">No matches.</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-waka-50"
                onClick={() => go(r)}
              >
                <span className="text-sm font-black text-stone-900">{r.label}</span>
                <span className="text-[11px] font-medium text-stone-500">
                  {r.type} · {r.sub}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AppVersionPanel({ versions }: { versions: { version: string; count: number; pct: number }[] }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-black text-stone-900">App versions</h2>
      <ul className="mt-3 space-y-2">
        {versions.slice(0, 5).map((v) => (
          <li key={v.version}>
            <div className="flex justify-between text-xs font-bold text-stone-700">
              <span>v{v.version}</span>
              <span>{v.pct}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-waka-500 transition-all" style={{ width: `${v.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlatformAnalyticsPanel({
  signups7,
  subs7,
  districts,
}: {
  signups7: { label: string; count: number }[];
  subs7: { label: string; count: number }[];
  districts: { label: string; totalShops: number }[];
}) {
  const maxSignup = Math.max(1, ...signups7.map((b) => b.count));
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-900">Growth (7 days)</h2>
        <div className="mt-3 flex h-24 items-end gap-1">
          {signups7.map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full max-w-[2rem] rounded-t-lg bg-waka-500"
                style={{ height: `${Math.max(8, (b.count / maxSignup) * 100)}%` }}
              />
              <span className="text-[9px] font-bold text-stone-400">{b.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Subscriptions 7d: {subs7.reduce((s, b) => s + b.count, 0)} new
        </p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-900">Top districts</h2>
        <ul className="mt-2 space-y-2">
          {districts.slice(0, 5).map((d) => (
            <li key={d.label} className="flex justify-between text-sm font-semibold">
              <span>{d.label}</span>
              <span className="font-mono text-stone-600">{d.totalShops}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function DeviceFleetCard({
  device,
  onOpenShop,
  onAction,
  canManage,
}: {
  device: FleetDeviceRow;
  onOpenShop: () => void;
  onAction: (action: string) => void;
  canManage: boolean;
}) {
  const online = deviceOnline(device.last_seen_at);
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-stone-900">{device.label ?? "Device"}</p>
          <button type="button" onClick={onOpenShop} className="text-xs font-bold text-waka-600">
            {device.shop_name} →
          </button>
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
            online ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600",
          )}
        >
          {online ? "Online" : "Offline"}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] font-semibold text-stone-600">
        <div>v{device.app_version ?? "?"}</div>
        <div>{device.platform ?? "—"}</div>
        <div>Sync pending: {device.pending_sync}</div>
        <div>{device.trusted ? "Trusted" : "Untrusted"}</div>
      </dl>
      {device.suspicious_flag ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-bold text-rose-700">
          <ShieldAlert className="h-3.5 w-3.5" /> Risk flag
        </p>
      ) : null}
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAction("trust")}
            className="min-h-[40px] rounded-xl border border-stone-200 px-3 text-[11px] font-black"
          >
            Trust
          </button>
          <button
            type="button"
            onClick={() => onAction("deactivate")}
            className="min-h-[40px] rounded-xl border border-stone-200 px-3 text-[11px] font-black"
          >
            Deactivate
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AnnouncementSheet({
  open,
  onClose,
  author,
}: {
  open: boolean;
  onClose: () => void;
  author: string;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<OpsAnnouncement["kind"]>("feature");
  const [list, setList] = useState(listAnnouncements);

  const submit = () => {
    if (!title.trim() || !body.trim()) return;
    createAnnouncement({ title: title.trim(), body: body.trim(), kind, createdBy: author });
    setList(listAnnouncements());
    setTitle("");
    setBody("");
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Announcement center" subtitle="Development only — saved in browser storage">
      <div className="space-y-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as OpsAnnouncement["kind"])}
          className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-bold"
        >
          <option value="maintenance">Maintenance</option>
          <option value="feature">Feature</option>
          <option value="payment">Payment reminder</option>
          <option value="update">App update</option>
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-bold"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Message to shops…"
          className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-semibold"
        />
        <button
          type="button"
          onClick={submit}
          className="min-h-[48px] w-full rounded-2xl bg-waka-600 text-sm font-black text-white"
        >
          Broadcast (saved locally)
        </button>
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-xl bg-stone-50 p-3 text-sm">
              <p className="font-black text-stone-900">{a.title}</p>
              <p className="text-xs text-stone-600">{a.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </BottomSheet>
  );
}

export function MassActionBar({
  count,
  onClear,
  onAction,
}: {
  count: number;
  onClear: () => void;
  onAction: (action: "suspend" | "extend_trial") => void;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-2 z-20 flex items-center justify-between gap-2 rounded-2xl border border-waka-200 bg-waka-600 px-4 py-3 text-white shadow-lg">
      <span className="text-sm font-black">{count} selected</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onAction("extend_trial")} className="rounded-xl bg-white/20 px-3 py-2 text-xs font-black">
          Extend trial
        </button>
        <button type="button" onClick={() => onAction("suspend")} className="rounded-xl bg-white/20 px-3 py-2 text-xs font-black">
          Suspend
        </button>
        <button type="button" onClick={onClear} className="rounded-xl bg-white/10 px-2 py-2 text-xs font-bold">
          Clear
        </button>
      </div>
    </div>
  );
}

export function ShopTimelinePanel({ events }: { events: OpsFeedEvent[] }) {
  return (
    <ul className="space-y-0 border-l-2 border-waka-200 pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative pb-4">
          <span className="absolute -left-[1.35rem] top-1 h-2.5 w-2.5 rounded-full bg-waka-500 ring-2 ring-white" />
          <p className="text-[10px] font-bold text-stone-500">{e.timeLabel}</p>
          <p className="text-sm font-semibold text-stone-900">{e.message}</p>
        </li>
      ))}
    </ul>
  );
}

export function InternalNotesPanel({
  shopId,
  author,
  previewMode = false,
  lang = "en" as Language,
  onToast,
}: {
  shopId: string;
  author?: string;
  previewMode?: boolean;
  lang?: Language;
  onToast?: (toast: { kind: "ok" | "err"; text: string }) => void;
}) {
  const [notes, setNotes] = useState<SharedInternalNote[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchShopInternalNotes(shopId).then(setNotes);
  }, [shopId]);

  const add = () => {
    if (!body.trim() || busy) return;
    void executeInternalAdminAction(
      {
        previewMode,
        previewBlockedMessage: t(lang, "internalAdminPreviewActionBlocked"),
        setBusy,
        onSuccess: () => {
          setBody("");
          void fetchShopInternalNotes(shopId).then(setNotes);
          onToast?.({ kind: "ok", text: "Note saved." });
        },
        onError: (msg) => onToast?.({ kind: "err", text: msg }),
        audit: { action: "admin_internal_note_add", shopId, metadata: { author } },
      },
      () => addShopInternalNote(shopId, body),
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-violet-900">Shared across all internal admins (cloud).</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Private staff note (VIP, fraud, extension…) "
        className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold"
      />
      <button
        type="button"
        disabled={busy}
        onClick={add}
        className="min-h-[44px] w-full rounded-xl bg-violet-600 text-sm font-black text-white disabled:opacity-50"
      >
        Save note
      </button>
      <ul className="space-y-2">
        {notes.length === 0 ? (
          <li className="text-sm font-semibold text-stone-500">No notes yet.</li>
        ) : (
          notes.map((n) => (
            <li key={n.id} className="rounded-xl bg-violet-50/80 p-3 text-sm">
              <p className="font-semibold text-stone-900">{n.body}</p>
              <p className="mt-1 text-[10px] text-stone-500">
                {n.author} · {new Date(n.created_at).toLocaleString("en-GB")}
              </p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
