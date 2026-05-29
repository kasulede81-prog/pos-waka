import type {
  InternalDashboardStats,
  PendingSubscriptionRequestRow,
  RecentShopRow,
  ShopOpsDetail,
  SupportTicketRow,
} from "./wakaInternalAdmin";
import { formatLastActive } from "./wakaInternalAdmin";

export type HealthLevel = "green" | "yellow" | "red";

export type ShopHealth = {
  score: number;
  level: HealthLevel;
  tags: SupportTag[];
  riskFlags: string[];
};

export type SupportTag =
  | "vip"
  | "high_sales"
  | "high_risk"
  | "new_shop"
  | "inactive"
  | "sync_problems";

export type SystemHealthStatus = "healthy" | "warning" | "critical";

export type SystemHealthSnapshot = {
  status: SystemHealthStatus;
  label: string;
  activeDevices: number;
  shopsOnline: number;
  shopsActiveToday: number;
  offlineShops: number;
  failedSyncs: number;
  queueDelays: number;
  openSupport: number;
  suspended: number;
  appVersionTop: string;
  appVersionShare: number;
};

export type OpsFeedEvent = {
  id: string;
  at: string;
  timeLabel: string;
  message: string;
  priority: "high" | "normal" | "low";
  shopId?: string;
  kind: "sync" | "signup" | "support" | "trial" | "device" | "risk" | "system";
};

const APP_CURRENT = import.meta.env.VITE_APP_VERSION ?? "1.0.0";

function minsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 60000);
}

function kampalaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function computeShopHealth(shop: RecentShopRow): ShopHealth {
  let score = 72;
  const riskFlags: string[] = [];
  const tags: SupportTag[] = [];

  if (!shop.is_active) {
    score -= 35;
    tags.push("inactive");
    riskFlags.push("Shop suspended or inactive");
  }

  const lastMins = minsSince(shop.last_seen_at);
  if (lastMins === null) {
    score -= 18;
    tags.push("inactive");
  } else if (lastMins > 24 * 60) {
    score -= 28;
    tags.push("inactive");
    riskFlags.push("No activity in 24h+");
  } else if (lastMins <= 30) {
    score += 12;
  } else if (lastMins > 180) {
    score -= 12;
  }

  const plan = (shop.plan_code ?? "").toLowerCase();
  if (plan === "waka_plus" || plan === "business") tags.push("vip");
  if ((shop.sale_count_30d ?? 0) >= 80) tags.push("high_sales");
  if ((shop.sale_count_30d ?? 0) >= 120) score += 8;

  if (shop.trial_days_left != null && shop.trial_days_left <= 3) {
    score -= 10;
    riskFlags.push("Trial ending soon");
  }

  if (shop.gps_missing) score -= 4;

  const created = shop.created_at ? new Date(shop.created_at).getTime() : 0;
  if (created && Date.now() - created < 14 * 86400000) tags.push("new_shop");

  if (shop.gps_missing && lastMins != null && lastMins > 360) tags.push("sync_problems");

  if (riskFlags.length >= 2) tags.push("high_risk");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: HealthLevel = score >= 75 ? "green" : score >= 50 ? "yellow" : "red";
  return { score, level, tags, riskFlags };
}

export function computeSystemHealth(
  stats: InternalDashboardStats | null,
  shops: RecentShopRow[],
  fleetPendingSync: number,
  versionBuckets: { version: string; count: number }[],
): SystemHealthSnapshot {
  const total = stats?.totalShops ?? shops.length;
  const shopsOnline = stats?.shopsOnlineNow ?? stats?.activeToday ?? 0;
  const shopsActiveToday = stats?.activeToday ?? 0;
  const offlineShops = Math.max(0, total - shopsOnline);
  const failedSyncs = fleetPendingSync;
  const queueDelays =
    (stats?.pendingAnnualRequests ?? 0) +
    (stats?.pendingAiRequests ?? 0) +
    (stats?.openSupportTickets ?? 0);
  const suspended = stats?.suspendedShops ?? 0;

  let status: SystemHealthStatus = "healthy";
  if (failedSyncs > 25 || offlineShops > total * 0.45 || suspended > 10) status = "critical";
  else if (failedSyncs > 8 || queueDelays > 12 || offlineShops > total * 0.25) status = "warning";

  const top = versionBuckets[0];
  const share = top && fleetPendingSync >= 0 ? Math.round((top.count / Math.max(1, versionBuckets.reduce((s, b) => s + b.count, 0))) * 100) : 0;

  return {
    status,
    label: status === "healthy" ? "Healthy" : status === "warning" ? "Warning" : "Critical",
    activeDevices: stats?.activeDevices ?? 0,
    shopsOnline,
    shopsActiveToday,
    offlineShops,
    failedSyncs,
    queueDelays,
    openSupport: stats?.openSupportTickets ?? 0,
    suspended,
    appVersionTop: top?.version ?? APP_CURRENT,
    appVersionShare: share,
  };
}

export function buildOpsActivityFeed(input: {
  shops: RecentShopRow[];
  tickets: SupportTicketRow[];
  pendingTrials: PendingSubscriptionRequestRow[];
  latestSignups: InternalDashboardStats["latestSignups"];
}): OpsFeedEvent[] {
  const events: OpsFeedEvent[] = [];

  for (const s of input.shops.slice(0, 40)) {
    const mins = minsSince(s.last_seen_at);
    if (mins != null && mins > 12 * 60) {
      events.push({
        id: `off-${s.id}`,
        at: s.last_seen_at ?? new Date().toISOString(),
        timeLabel: kampalaTime(s.last_seen_at ?? new Date().toISOString()),
        message: `${s.name} offline · ${formatLastActive(s.last_seen_at)}`,
        priority: mins > 24 * 60 ? "high" : "normal",
        shopId: s.id,
        kind: "sync",
      });
    }
    if (s.gps_missing && (s.sale_count_30d ?? 0) === 0) {
      events.push({
        id: `sync-${s.id}`,
        at: new Date().toISOString(),
        timeLabel: kampalaTime(new Date().toISOString()),
        message: `${s.name} — sync / GPS attention`,
        priority: "normal",
        shopId: s.id,
        kind: "sync",
      });
    }
  }

  for (const t of input.tickets.slice(0, 15)) {
    if (t.status !== "pending" && t.status !== "open") continue;
    events.push({
      id: `tk-${t.id}`,
      at: t.created_at,
      timeLabel: kampalaTime(t.created_at),
      message: `${t.shop_name ?? "Shop"} — ${t.issue_type ?? t.subject ?? "Support"}`,
      priority: t.priority === "high" ? "high" : "normal",
      shopId: t.shop_id ?? undefined,
      kind: "support",
    });
  }

  for (const req of input.pendingTrials.slice(0, 10)) {
    events.push({
      id: `trial-${req.id}`,
      at: req.created_at,
      timeLabel: kampalaTime(req.created_at),
      message: `Trial request · ${req.requested_plan.toUpperCase()}`,
      priority: "normal",
      kind: "trial",
    });
  }

  for (const s of input.latestSignups?.slice(0, 8) ?? []) {
    events.push({
      id: `new-${s.shop_id}`,
      at: s.created_at,
      timeLabel: kampalaTime(s.created_at),
      message: `New shop · ${s.shop_name}${s.district ? ` (${s.district})` : ""}`,
      priority: "low",
      shopId: s.shop_id,
      kind: "signup",
    });
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 40);
}

export function aggregateAppVersions(devices: { app_version: string | null }[]): { version: string; count: number; pct: number }[] {
  const map = new Map<string, number>();
  for (const d of devices) {
    const v = d.app_version?.trim() || "unknown";
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .map(([version, count]) => ({ version, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

export function buildShopTimelineFromDetail(detail: ShopOpsDetail): OpsFeedEvent[] {
  const events: OpsFeedEvent[] = [];
  if (detail.shop.created_at) {
    events.push({
      id: "created",
      at: detail.shop.created_at,
      timeLabel: kampalaTime(detail.shop.created_at),
      message: "Shop registered",
      priority: "low",
      kind: "signup",
    });
  }
  for (const p of detail.subscriptionPaymentsRecent) {
    events.push({
      id: `pay-${p.id}`,
      at: p.created_at,
      timeLabel: kampalaTime(p.created_at),
      message: `Payment UGX ${p.amount_ugx.toLocaleString("en-UG")} · ${p.status}`,
      priority: "normal",
      kind: "trial",
    });
  }
  for (const d of detail.devices) {
    if (d.suspicious_flag) {
      events.push({
        id: `dev-risk-${d.id}`,
        at: d.last_seen_at ?? d.created_at,
        timeLabel: kampalaTime(d.last_seen_at ?? d.created_at),
        message: `Device flagged · ${d.label ?? d.device_fingerprint.slice(0, 8)}`,
        priority: "high",
        kind: "risk",
      });
    }
  }
  if (detail.sync_health?.last_error) {
    events.push({
      id: "sync-err",
      at: detail.sync_health.updated_at,
      timeLabel: kampalaTime(detail.sync_health.updated_at),
      message: `Sync error · ${detail.sync_health.last_error.slice(0, 80)}`,
      priority: "high",
      kind: "sync",
    });
  }
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function detectFraudSignals(detail: ShopOpsDetail): string[] {
  const flags: string[] = [];
  const untrusted = detail.devices.filter((d) => !d.trusted).length;
  const suspicious = detail.devices.filter((d) => d.suspicious_flag).length;
  if (suspicious > 0) flags.push(`${suspicious} suspicious device(s)`);
  if (untrusted >= 3) flags.push("Many untrusted devices");
  if (detail.sync_health && detail.sync_health.pending_outbound > 50) {
    flags.push("Large pending sync queue");
  }
  if (!detail.shop.is_active && (detail.sale_count_30d ?? 0) > 200) {
    flags.push("High sales while shop inactive");
  }
  return flags;
}

export function deviceOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 15 * 60 * 1000;
}

export function healthColor(level: HealthLevel): string {
  if (level === "green") return "text-emerald-700 bg-emerald-100";
  if (level === "yellow") return "text-amber-800 bg-amber-100";
  return "text-rose-800 bg-rose-100";
}

export function tagLabel(tag: SupportTag): string {
  const map: Record<SupportTag, string> = {
    vip: "VIP",
    high_sales: "High sales",
    high_risk: "High risk",
    new_shop: "New",
    inactive: "Inactive",
    sync_problems: "Sync",
  };
  return map[tag];
}

export const CURRENT_APP_VERSION = APP_CURRENT;
