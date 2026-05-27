import { supabase } from "./supabase";

export type WakaInternalAdminRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  assigned_district_ids: string[] | null;
  active: boolean;
  max_shops: number | null;
};

export type InternalAdminRow = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  assigned_district_ids: string[] | null;
  active: boolean;
  created_at: string | null;
};

export type LatestSignupCard = {
  shop_id: string;
  shop_name: string;
  created_at: string;
  district: string | null;
  owner_email: string | null;
  owner_name: string | null;
  plan_code: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
};

export type InternalDashboardStats = {
  totalShops: number;
  activeToday: number;
  trialSubscriptions: number;
  paidSubscriptions: number;
  expiredSubscriptions: number;
  suspendedShops: number;
  pendingAiRequests: number;
  pendingAnnualRequests: number;
  /** Trials past end date but still marked trial/trialing (ops signal). */
  lapsedTrials: number;
  /** Trials ending within the next 7 days. */
  expiringTrialsNext7d: number;
  /** Active rows in shop_devices. */
  activeDevices: number;
  /** Support requests in open or in_progress. */
  openSupportTickets: number;
  salesTotalUgx: number | null;
  shopsByDistrict: { label: string; count: number }[];
  latestSignups: LatestSignupCard[];
};

function kampalaDayStartIso(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}T00:00:00+03:00`;
}

/** Server-backed internal staff row (RLS). */
export async function fetchWakaInternalAdminMe(): Promise<WakaInternalAdminRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("waka_internal_me");
  if (error || !data?.length) return null;
  const r = data[0] as {
    id: string;
    email: string | null;
    full_name: string | null;
    role: string;
    assigned_district_ids: string[] | null;
    active: boolean;
    max_shops: number | null;
  };
  return {
    id: r.id,
    email: r.email,
    full_name: r.full_name,
    role: r.role,
    assigned_district_ids: r.assigned_district_ids,
    active: r.active,
    max_shops: r.max_shops,
  };
}

export async function fetchInternalAdmins(): Promise<InternalAdminRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("internal_admins")
    .select("id,user_id,email,full_name,role,assigned_district_ids,active,created_at")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as unknown as InternalAdminRow[];
}

export async function internalAdminCreateByEmail({
  email,
  fullName,
  role,
  assignedDistrictIds,
}: {
  email: string;
  fullName: string | null;
  role: string;
  assignedDistrictIds: string[];
}): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_admin_create_by_email", {
    p_email: email,
    p_full_name: fullName,
    p_role: role,
    p_assigned_district_ids: assignedDistrictIds,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: data ? undefined : undefined };
}

export async function internalAdminSetActive({
  internalAdminId,
  active,
}: {
  internalAdminId: string;
  active: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("internal_admin_set_active", {
    p_internal_admin_id: internalAdminId,
    p_active: active,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function internalAdminUpdateRoleAndDistricts({
  internalAdminId,
  role,
  fullName,
  assignedDistrictIds,
}: {
  internalAdminId: string;
  role: string;
  fullName: string | null;
  assignedDistrictIds: string[];
}): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("internal_admin_update_role_and_districts", {
    p_internal_admin_id: internalAdminId,
    p_role: role,
    p_assigned_district_ids: assignedDistrictIds,
    p_full_name: fullName,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

function parseMetricsRpcPayload(raw: unknown): InternalDashboardStats | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  const shopsByDistrictRaw = j.shops_by_district;
  let shopsByDistrict: { label: string; count: number }[] = [];
  if (Array.isArray(shopsByDistrictRaw)) {
    shopsByDistrict = shopsByDistrictRaw
      .map((row) => {
        const r = row as Record<string, unknown>;
        return { label: String(r.label ?? "—"), count: Number(r.count ?? 0) };
      })
      .filter((x) => x.label.length > 0);
  }
  const latestRaw = j.latest_signups;
  let latestSignups: LatestSignupCard[] = [];
  if (Array.isArray(latestRaw)) {
    latestSignups = latestRaw.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        shop_id: String(r.shop_id ?? ""),
        shop_name: String(r.shop_name ?? "—"),
        created_at: String(r.created_at ?? ""),
        district: (r.district as string) ?? null,
        owner_email: (r.owner_email as string) ?? null,
        owner_name: (r.owner_name as string) ?? null,
        plan_code: (r.plan_code as string) ?? null,
        subscription_status: (r.subscription_status as string) ?? null,
        trial_ends_at: (r.trial_ends_at as string) ?? null,
      };
    });
  }
  return {
    totalShops: Number(j.total_shops ?? 0),
    activeToday: Number(j.active_today ?? 0),
    trialSubscriptions: Number(j.trial_subscriptions ?? 0),
    paidSubscriptions: Number(j.paid_subscriptions ?? 0),
    expiredSubscriptions: Number(j.expired_subscriptions ?? 0),
    suspendedShops: Number(j.suspended_shops ?? 0),
    pendingAiRequests: Number(j.pending_ai_requests ?? 0),
    pendingAnnualRequests: Number(j.pending_annual_requests ?? 0),
    lapsedTrials: Number(j.lapsed_trials ?? 0),
    expiringTrialsNext7d: Number(j.expiring_trials_7d ?? 0),
    activeDevices: Number(j.active_devices ?? 0),
    openSupportTickets: Number(j.open_support ?? 0),
    salesTotalUgx: j.sales_total_ugx === null || j.sales_total_ugx === undefined ? null : Number(j.sales_total_ugx),
    shopsByDistrict,
    latestSignups,
  };
}

export type FetchInternalDashboardStatsResult =
  | { ok: true; stats: InternalDashboardStats }
  | { ok: false; stats: null; message: string };

/** Single round-trip dashboard pulse (counts + district strip + sales total). */
export async function fetchInternalDashboardStats(): Promise<FetchInternalDashboardStatsResult> {
  if (!supabase) return { ok: false, stats: null, message: "Supabase client is not configured." };

  const { data: rpcData, error: rpcError } = await supabase.rpc("internal_ops_dashboard_metrics");
  if (!rpcError && rpcData) {
    const parsed = parseMetricsRpcPayload(rpcData);
    if (parsed) return { ok: true, stats: parsed };
  }
  const rpcFailMsg = rpcError?.message?.trim();

  const dayStart = kampalaDayStartIso();

  const [
    shopsAll,
    shopsActive,
    subsTrial,
    subsPaid,
    subsExpired,
    shopsDistrict,
    salesRpc,
    lapsed,
    exp7,
    devCount,
    supOpen,
  ] = await Promise.all([
    supabase.from("shops").select("id", { count: "exact", head: true }),
    supabase.from("shops").select("id", { count: "exact", head: true }).gte("last_seen_at", dayStart),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["trial", "trialing"]),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "expired"),
    supabase.from("shops").select("district, city"),
    supabase.rpc("internal_ops_sales_total_ugx"),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["trial", "trialing"])
      .not("trial_ends_at", "is", null)
      .lt("trial_ends_at", new Date().toISOString()),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["trial", "trialing"])
      .gte("trial_ends_at", new Date().toISOString())
      .lte("trial_ends_at", new Date(Date.now() + 7 * 86400000).toISOString()),
    supabase.from("shop_devices").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("support_requests").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
  ]);

  if (
    shopsAll.error ||
    shopsActive.error ||
    shopsDistrict.error ||
    subsTrial.error ||
    subsPaid.error ||
    subsExpired.error
  ) {
    const first =
      shopsAll.error?.message ||
      shopsActive.error?.message ||
      shopsDistrict.error?.message ||
      subsTrial.error?.message ||
      subsPaid.error?.message ||
      subsExpired.error?.message ||
      rpcFailMsg;
    return { ok: false, stats: null, message: first ?? "Could not load dashboard metrics." };
  }

  const byDistrict = new Map<string, number>();
  for (const row of shopsDistrict.data ?? []) {
    const label = (row.district as string | null)?.trim() || (row.city as string | null)?.trim() || "—";
    byDistrict.set(label, (byDistrict.get(label) ?? 0) + 1);
  }
  const shopsByDistrict = [...byDistrict.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const salesTotalUgx =
    salesRpc.error || salesRpc.data === null || salesRpc.data === undefined ? null : Number(salesRpc.data);

  const devFallback = devCount.error ? await supabase.from("shops").select("active_device_count") : null;
  const activeDevices =
    devCount.error || devCount.count === null
      ? (devFallback?.data ?? []).reduce((s, r) => s + (Number((r as { active_device_count?: number }).active_device_count) || 0), 0)
      : (devCount.count ?? 0);

  return {
    ok: true,
    stats: {
      totalShops: shopsAll.count ?? 0,
      activeToday: shopsActive.count ?? 0,
      trialSubscriptions: subsTrial.count ?? 0,
      paidSubscriptions: subsPaid.count ?? 0,
      expiredSubscriptions: subsExpired.count ?? 0,
      suspendedShops: 0,
      pendingAiRequests: 0,
      pendingAnnualRequests: 0,
      lapsedTrials: lapsed.error ? 0 : (lapsed.count ?? 0),
      expiringTrialsNext7d: exp7.error ? 0 : (exp7.count ?? 0),
      activeDevices,
      openSupportTickets: supOpen.error ? 0 : (supOpen.count ?? 0),
      salesTotalUgx,
      shopsByDistrict,
      latestSignups: [],
    },
  };
}

/** Last 7 Kampala days: signups, new subscriptions, completed sales UGX (server-side). */
export async function fetchInternalOpsCharts7d(): Promise<{
  signups: DayBucket[];
  subscriptions: DayBucket[];
  sales: DayBucket[];
} | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("internal_ops_chart_buckets_7d");
  if (error || !data || typeof data !== "object") return null;
  const j = data as Record<string, unknown>;
  const labels = (Array.isArray(j.labels) ? j.labels : []) as string[];
  const su = (Array.isArray(j.shop_signups) ? j.shop_signups : []) as number[];
  const sub = (Array.isArray(j.subscriptions) ? j.subscriptions : []) as number[];
  const sal = (Array.isArray(j.sales_ugx) ? j.sales_ugx : []) as number[];
  const n = Math.min(labels.length, su.length, sub.length, sal.length);
  const signups: DayBucket[] = [];
  const subscriptions: DayBucket[] = [];
  const sales: DayBucket[] = [];
  for (let i = 0; i < n; i++) {
    const label = labels[i] ?? "";
    signups.push({ label, count: Number(su[i] ?? 0) });
    subscriptions.push({ label, count: Number(sub[i] ?? 0) });
    sales.push({ label, count: Number(sal[i] ?? 0) });
  }
  return { signups, subscriptions, sales };
}

export type FieldVisitRow = {
  id: string;
  shop_id: string;
  visit_status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
  shops: { name: string; latitude: number | null; longitude: number | null; district: string | null; city: string | null } | null;
};

export async function fetchFieldVisitsOpen(): Promise<FieldVisitRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("field_visits")
    .select(
      "id, shop_id, visit_status, scheduled_at, completed_at, notes, shops ( name, latitude, longitude, district, city )",
    )
    .neq("visit_status", "completed")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(40);
  if (error || !data) return [];
  return (data as unknown as Array<Omit<FieldVisitRow, "shops"> & { shops: FieldVisitRow["shops"] | FieldVisitRow["shops"][] }>).map(
    (row) => ({
      ...row,
      shops: Array.isArray(row.shops) ? row.shops[0] ?? null : row.shops,
    }),
  );
}

export async function markFieldVisitCompleted(visitId: string, notes?: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("field_visit_mark_completed", {
    p_visit_id: visitId,
    p_notes: notes ?? null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function formatDisplayEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return e || null;
}

export function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  if (ms < 15 * 60 * 1000) return "Active now";
  if (ms < 60 * 60 * 1000) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export const ADMIN_PLAN_CODES = ["free", "starter", "business", "waka_plus"] as const;
export type AdminPlanCode = (typeof ADMIN_PLAN_CODES)[number];

const PLAN_CODES = ["starter", "business", "waka_plus"] as const;

export type PlanTierMetrics = {
  code: (typeof PLAN_CODES)[number];
  activeCount: number;
  trialCount: number;
  expiringSoonCount: number;
  monthlyPriceUgx: number;
  estimatedMonthlyRevenueUgx: number;
};

export type RecentShopRow = {
  id: string;
  name: string;
  district: string | null;
  city: string | null;
  is_active: boolean;
  created_at: string;
  plan_code: string | null;
  trial_days_left: number | null;
  /** Display label from profile / email (internal RPC). */
  owner_label?: string | null;
  owner_email?: string | null;
  phone_e164?: string | null;
  business_type?: string | null;
  gps_missing?: boolean | null;
  last_seen_at?: string | null;
  product_count?: number;
  sale_count_30d?: number;
};

export type PendingSubscriptionRequestRow = {
  id: string;
  organization_id: string;
  shop_id: string | null;
  requested_by: string | null;
  requested_plan: string;
  status: string;
  notes: string | null;
  created_at: string;
};

export async function fetchPendingSubscriptionRequests(limit = 50): Promise<PendingSubscriptionRequestRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_subscription_requests_pending", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data as PendingSubscriptionRequestRow[];
}

export async function internalOpsSetSubscriptionRequestStatus(
  requestId: string,
  status: "approved" | "rejected",
  note?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_subscription_request_set_status", {
    p_request_id: requestId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok === true) return { ok: true };
  return { ok: false, message: j.error ?? "Request could not be updated." };
}

export type ShopOpsDetail = {
  shop: {
    id: string;
    name: string;
    district: string | null;
    city: string | null;
    is_active: boolean;
    organization_id: string;
    last_seen_at: string | null;
    phone_e164: string | null;
    created_at: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  owner_label: string | null;
  owner_email: string | null;
  product_count: number;
  sale_count_30d: number;
  last_sale_at: string | null;
  subscription: {
    id: string;
    status: string;
    trial_ends_at: string | null;
    plan_code: string | null;
    payment_status?: string | null;
    current_period_end?: string | null;
  } | null;
  plan_code: string | null;
  devices: ShopDeviceRow[];
  sync_health: SyncHealthRow | null;
  subscriptionPaymentsRecent: SubscriptionPaymentRow[];
};

export type SupportTicketRow = {
  id: string;
  subject: string | null;
  body: string | null;
  status: string;
  priority: string;
  channel: string;
  created_at: string;
  organization_id?: string | null;
  shop_id: string | null;
  shop_name: string | null;
  shop_district: string | null;
  shop_phone_e164: string | null;
  contact_phone_e164: string | null;
  owner_name: string | null;
  owner_email: string | null;
  issue_type: string | null;
  device_fingerprint: string | null;
  app_version: string | null;
  sync_health_snapshot: Record<string, unknown> | null;
  assigned_internal_admin_id: string | null;
  assigned_admin_email: string | null;
};

export type FieldMapPin = {
  shop_id: string;
  shop_name: string;
  lat: number;
  lng: number;
  district: string | null;
  city: string | null;
  is_active: boolean;
  district_id: string | null;
  owner_label?: string | null;
  plan_code?: string | null;
  subscription_status?: string | null;
  last_seen_at?: string | null;
};

export type ShopDeviceRow = {
  id: string;
  shop_id: string;
  device_fingerprint: string;
  label: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  is_active: boolean;
  trusted: boolean;
  suspicious_flag: boolean;
  created_at: string;
};

export type SubscriptionPaymentRow = {
  id: string;
  amount_ugx: number;
  currency: string;
  provider: string | null;
  status: string;
  note: string | null;
  created_at: string;
};

export type SyncHealthRow = {
  shop_id: string;
  last_pull_at: string | null;
  last_push_ok_at: string | null;
  pending_outbound: number;
  last_error: string | null;
  updated_at: string;
};

export type DistrictOpsRow = {
  districtId: string | null;
  label: string;
  totalShops: number;
  activeToday: number;
  /** Shops whose org has an active paid subscription (approximation). */
  paidShops: number;
  fieldAgentsAssigned: number;
};

export type BusinessTypeSlice = { type: string; count: number };

/** Last N days bucket counts (oldest → newest) for tiny charts. */
export type DayBucket = { label: string; count: number };

async function planIdByCode(code: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("subscription_plans").select("id, monthly_price_ugx").eq("code", code).maybeSingle();
  if (error || !data?.id) return null;
  return data.id as string;
}

function trialDaysLeft(trialEndsAt: string | null, status: string): number | null {
  if (!trialEndsAt) return null;
  const st = (status ?? "").toLowerCase();
  if (!["trial", "trialing"].includes(st)) return null;
  const end = new Date(trialEndsAt).getTime();
  const d = Math.ceil((end - Date.now()) / 86400000);
  return d < 0 ? 0 : d;
}

/** Per-plan subscription breakdown (counts only; no schema changes). */
export async function fetchPlanTierMetrics(): Promise<PlanTierMetrics[]> {
  if (!supabase) return [];
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString();

  const out: PlanTierMetrics[] = [];
  for (const code of PLAN_CODES) {
    const planId = await planIdByCode(code);
    if (!planId) {
      out.push({ code, activeCount: 0, trialCount: 0, expiringSoonCount: 0, monthlyPriceUgx: 0, estimatedMonthlyRevenueUgx: 0 });
      continue;
    }
    const { data: priceRow } = await supabase.from("subscription_plans").select("monthly_price_ugx").eq("id", planId).maybeSingle();
    const monthlyPriceUgx = Number(priceRow?.monthly_price_ugx ?? 0);

    const [active, trial, expSoon] = await Promise.all([
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("plan_id", planId).eq("status", "active"),
      supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", planId)
        .in("status", ["trial", "trialing"]),
      supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", planId)
        .in("status", ["trial", "trialing"])
        .gte("trial_ends_at", new Date().toISOString())
        .lte("trial_ends_at", weekEnd),
    ]);

    const activeCount = active.count ?? 0;
    const trialCount = trial.count ?? 0;
    const expiringSoonCount = expSoon.count ?? 0;
    out.push({
      code,
      activeCount,
      trialCount,
      expiringSoonCount,
      monthlyPriceUgx,
      estimatedMonthlyRevenueUgx: activeCount * monthlyPriceUgx,
    });
  }
  return out;
}

export async function fetchExpiringTrialsTotal(): Promise<number> {
  if (!supabase) return 0;
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString();
  const { count, error } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .in("status", ["trial", "trialing"])
    .gte("trial_ends_at", new Date().toISOString())
    .lte("trial_ends_at", weekEnd);
  if (error) return 0;
  return count ?? 0;
}

export async function fetchActiveDevicesTotal(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.from("shops").select("active_device_count");
  if (error || !data) return 0;
  return data.reduce((s, r) => s + (Number(r.active_device_count) || 0), 0);
}

export async function fetchOpenSupportCount(): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("support_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress"]);
  if (error) return 0;
  return count ?? 0;
}

function mapSupportRpcRow(row: Record<string, unknown>): SupportTicketRow {
  return {
    id: row.id as string,
    subject: (row.subject as string) ?? null,
    body: (row.body as string) ?? null,
    status: row.status as string,
    priority: row.priority as string,
    channel: row.channel as string,
    created_at: row.created_at as string,
    organization_id: (row.organization_id as string) ?? null,
    shop_id: (row.shop_id as string) ?? null,
    shop_name: (row.shop_name as string) ?? null,
    shop_district: (row.shop_district as string) ?? null,
    shop_phone_e164: (row.shop_phone_e164 as string) ?? null,
    contact_phone_e164: (row.contact_phone_e164 as string) ?? null,
    owner_name: (row.owner_name as string) ?? null,
    owner_email: (row.owner_email as string) ?? null,
    issue_type: (row.issue_type as string) ?? null,
    device_fingerprint: (row.device_fingerprint as string) ?? null,
    app_version: (row.app_version as string) ?? null,
    sync_health_snapshot:
      row.sync_health_snapshot && typeof row.sync_health_snapshot === "object"
        ? (row.sync_health_snapshot as Record<string, unknown>)
        : null,
    assigned_internal_admin_id: (row.assigned_internal_admin_id as string) ?? null,
    assigned_admin_email: (row.assigned_admin_email as string) ?? null,
  };
}

function normalizeSupportQueueRpcData(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data != null && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

export async function fetchSupportTickets(limit = 25): Promise<SupportTicketRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_support_queue", { p_limit: limit });
  const rows = normalizeSupportQueueRpcData(data);
  if (!error && rows.length) {
    return rows.map((row) => mapSupportRpcRow(row));
  }
  const { data: fallback, error: fbErr } = await supabase
    .from("support_requests")
    .select("id, subject, body, status, priority, channel, created_at, contact_phone_e164, shops ( id, name, district, phone_e164 )")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (fbErr || !fallback) return [];
  return (fallback as Array<Record<string, unknown> & { shops?: { id?: string; name?: string; district?: string; phone_e164?: string }[] }>).map(
    (row) => {
      const sh = row.shops;
      const shop = Array.isArray(sh) ? sh[0] : sh;
      return mapSupportRpcRow({
        ...row,
        organization_id: null,
        shop_id: shop?.id ?? null,
        shop_name: shop?.name ?? null,
        shop_district: shop?.district ?? null,
        shop_phone_e164: shop?.phone_e164 ?? null,
        owner_name: null,
        owner_email: null,
        issue_type: null,
        device_fingerprint: null,
        app_version: null,
        sync_health_snapshot: {},
        assigned_internal_admin_id: null,
        assigned_admin_email: null,
      });
    },
  );
}

export async function fetchFieldMapPins(opts?: { districtId?: string | null; limit?: number }): Promise<FieldMapPin[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("internal_ops_field_map_pins", {
    p_district_id: opts?.districtId ?? null,
    p_limit: opts?.limit ?? 400,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    shop_id: r.shop_id as string,
    shop_name: (r.shop_name as string) ?? "—",
    lat: Number(r.lat),
    lng: Number(r.lng),
    district: (r.district as string) ?? null,
    city: (r.city as string) ?? null,
    is_active: Boolean(r.is_active),
    district_id: (r.district_id as string) ?? null,
    owner_label: (r.owner_label as string) ?? null,
    plan_code: (r.plan_code as string) ?? null,
    subscription_status: (r.subscription_status as string) ?? null,
    last_seen_at: (r.last_seen_at as string) ?? null,
  }));
}

export async function updateSupportTicketStatus(
  id: string,
  status: "open" | "in_progress" | "resolved" | "closed",
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.from("support_requests").update({ status }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteSupportTicket(id: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_delete_support_request", { p_request_id: id });
  if (error) return { ok: false, message: error.message };
  const payload = data as { ok?: boolean; message?: string } | null;
  return { ok: Boolean(payload?.ok), message: payload?.message };
}

export async function deleteSubscriptionRequest(id: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_delete_subscription_request", { p_request_id: id });
  if (error) return { ok: false, message: error.message };
  const payload = data as { ok?: boolean; message?: string } | null;
  return { ok: Boolean(payload?.ok), message: payload?.message };
}

type RecentShopDbRow = {
  id: string;
  name: string;
  district: string | null;
  city: string | null;
  is_active: boolean;
  created_at: string;
  organization_id: string;
  last_seen_at?: string | null;
  phone_e164?: string | null;
  business_type?: string | null;
  gps_missing?: boolean | null;
};

async function enrichRecentShopRows(shops: RecentShopDbRow[]): Promise<RecentShopRow[]> {
  if (!supabase || shops.length === 0) return [];
  const orgIds = [...new Set(shops.map((s) => s.organization_id).filter(Boolean))];
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("organization_id, status, trial_ends_at, plan_id, subscription_plans ( code )")
    .in("organization_id", orgIds);

  type SubRow = {
    organization_id: string;
    status: string;
    trial_ends_at: string | null;
    subscription_plans: { code: string } | { code: string }[] | null;
  };
  const subList = (subs ?? []) as unknown as SubRow[];
  const orgToSub = new Map<string, SubRow>();
  for (const s of subList) {
    if (!orgToSub.has(s.organization_id)) orgToSub.set(s.organization_id, s);
  }

  return shops.map((s) => {
    const sub = orgToSub.get(s.organization_id);
    let plan_code: string | null = null;
    if (sub?.subscription_plans) {
      const p = sub.subscription_plans;
      plan_code = (Array.isArray(p) ? p[0]?.code : p.code) ?? null;
    }
    const trial_days_left = sub ? trialDaysLeft(sub.trial_ends_at, sub.status) : null;
    return {
      id: s.id,
      name: s.name ?? "—",
      district: s.district ?? null,
      city: s.city ?? null,
      is_active: Boolean(s.is_active),
      created_at: s.created_at ?? "",
      plan_code,
      trial_days_left,
      owner_label: null,
      owner_email: null,
      phone_e164: s.phone_e164 ?? null,
      business_type: s.business_type ?? null,
      gps_missing: s.gps_missing ?? null,
      last_seen_at: s.last_seen_at ?? null,
      product_count: undefined,
      sale_count_30d: undefined,
    };
  });
}

function mapRecentShopRpcRow(row: Record<string, unknown>): RecentShopRow {
  const status = (row.subscription_status as string) ?? "";
  const trialEnds = (row.trial_ends_at as string | null) ?? null;
  return {
    id: row.id as string,
    name: (row.name as string) ?? "—",
    district: (row.district as string) ?? null,
    city: (row.city as string) ?? null,
    is_active: Boolean(row.is_active),
    created_at: (row.created_at as string) ?? "",
    plan_code: (row.plan_code as string) ?? null,
    trial_days_left: trialDaysLeft(trialEnds, status),
    owner_label: (row.owner_label as string) ?? null,
    owner_email: formatDisplayEmail(row.owner_email as string) ?? null,
    phone_e164: (row.phone_e164 as string) ?? null,
    business_type: (row.business_type as string) ?? null,
    gps_missing: row.gps_missing === null || row.gps_missing === undefined ? null : Boolean(row.gps_missing),
    last_seen_at: (row.last_seen_at as string) ?? null,
    product_count: Number(row.product_count ?? 0),
    sale_count_30d: Number(row.sale_count_30d ?? 0),
  };
}

/** Shops sorted by signup date (newest first) — best for spotting new registrations. */
export async function fetchShopsBySignupDate(limit = 50): Promise<RecentShopRow[]> {
  if (!supabase) return [];
  const cap = Math.min(Math.max(limit, 1), 100);
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, district, city, is_active, created_at, organization_id, last_seen_at, phone_e164, business_type, gps_missing")
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error || !shops?.length) return [];
  return enrichRecentShopRows(shops);
}

export async function fetchRecentShops(limit = 20): Promise<RecentShopRow[]> {
  if (!supabase) return [];

  const { data: rpcRows, error: rpcError } = await supabase.rpc("internal_ops_recent_shops", { p_limit: limit });
  if (!rpcError && rpcRows && Array.isArray(rpcRows)) {
    return (rpcRows as Array<Record<string, unknown>>).map((row) => mapRecentShopRpcRow(row));
  }

  return fetchShopsBySignupDate(limit);
}

export async function fetchShopOpsDetail(shopId: string): Promise<ShopOpsDetail | null> {
  if (!supabase) return null;
  const { data: rpcRaw, error: rpcErr } = await supabase.rpc("internal_ops_shop_detail", { p_shop_id: shopId });
  if (!rpcErr && rpcRaw && typeof rpcRaw === "object") {
    const j = rpcRaw as Record<string, unknown>;
    const shopRaw = j.shop as Record<string, unknown> | undefined;
    if (!shopRaw?.id) return null;
    const subRaw = j.subscription as Record<string, unknown> | null | undefined;
    let subscription: ShopOpsDetail["subscription"] = null;
    if (subRaw?.id) {
      const metaPlan = (j.plan_code as string) ?? null;
      subscription = {
        id: subRaw.id as string,
        status: (subRaw.status as string) ?? "",
        trial_ends_at: (subRaw.trial_ends_at as string) ?? null,
        plan_code: metaPlan,
        payment_status: (subRaw.payment_status as string) ?? null,
        current_period_end: (subRaw.current_period_end as string) ?? null,
      };
    }
    const devicesRaw = j.devices;
    const devices: ShopDeviceRow[] = Array.isArray(devicesRaw)
      ? (devicesRaw as Record<string, unknown>[]).map((d) => ({
          id: d.id as string,
          shop_id: d.shop_id as string,
          device_fingerprint: (d.device_fingerprint as string) ?? "",
          label: (d.label as string) ?? null,
          platform: (d.platform as string) ?? null,
          app_version: (d.app_version as string) ?? null,
          last_seen_at: (d.last_seen_at as string) ?? null,
          is_active: Boolean(d.is_active),
          trusted: Boolean(d.trusted),
          suspicious_flag: Boolean(d.suspicious_flag),
          created_at: (d.created_at as string) ?? "",
        }))
      : [];
    const syRaw = j.sync_health as Record<string, unknown> | null | undefined;
    const sync_health: SyncHealthRow | null =
      syRaw && syRaw.shop_id
        ? {
            shop_id: syRaw.shop_id as string,
            last_pull_at: (syRaw.last_pull_at as string) ?? null,
            last_push_ok_at: (syRaw.last_push_ok_at as string) ?? null,
            pending_outbound: Number(syRaw.pending_outbound ?? 0),
            last_error: (syRaw.last_error as string) ?? null,
            updated_at: (syRaw.updated_at as string) ?? "",
          }
        : null;
    const payRaw = j.subscription_payments_recent;
    const subscriptionPaymentsRecent: SubscriptionPaymentRow[] = Array.isArray(payRaw)
      ? (payRaw as Record<string, unknown>[]).map((p) => ({
          id: p.id as string,
          amount_ugx: Number(p.amount_ugx ?? 0),
          currency: (p.currency as string) ?? "UGX",
          provider: (p.provider as string) ?? null,
          status: (p.status as string) ?? "",
          note: (p.note as string) ?? null,
          created_at: (p.created_at as string) ?? "",
        }))
      : [];
    return {
      shop: {
        id: shopRaw.id as string,
        name: (shopRaw.name as string) ?? "—",
        district: (shopRaw.district as string) ?? null,
        city: (shopRaw.city as string) ?? null,
        is_active: Boolean(shopRaw.is_active),
        organization_id: shopRaw.organization_id as string,
        last_seen_at: (shopRaw.last_seen_at as string) ?? null,
        phone_e164: (shopRaw.phone_e164 as string) ?? null,
        created_at: (shopRaw.created_at as string) ?? null,
        latitude: shopRaw.latitude != null ? Number(shopRaw.latitude) : null,
        longitude: shopRaw.longitude != null ? Number(shopRaw.longitude) : null,
      },
      owner_label: (j.owner_label as string) ?? null,
      owner_email: formatDisplayEmail(j.owner_email as string),
      product_count: Number(j.product_count ?? 0),
      sale_count_30d: Number(j.sale_count_30d ?? 0),
      last_sale_at: (j.last_sale_at as string) ?? null,
      subscription,
      plan_code: (j.plan_code as string) ?? null,
      devices,
      sync_health,
      subscriptionPaymentsRecent,
    };
  }

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, name, district, city, is_active, organization_id, last_seen_at, phone_e164, created_at, latitude, longitude")
    .eq("id", shopId)
    .maybeSingle();
  if (shopErr || !shop) return null;

  const orgId = shop.organization_id as string;
  const { data: subRows } = await supabase
    .from("subscriptions")
    .select("id, status, trial_ends_at, payment_status, current_period_end, plan_id, subscription_plans ( code )")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  const raw = subRows?.[0] as
    | {
        id: string;
        status: string;
        trial_ends_at: string | null;
        payment_status: string | null;
        current_period_end: string | null;
        subscription_plans: { code: string } | { code: string }[] | null;
      }
    | undefined;
  let subscription: ShopOpsDetail["subscription"] = null;
  let plan_code: string | null = null;
  if (raw) {
    const p = raw.subscription_plans;
    plan_code = p ? (Array.isArray(p) ? p[0]?.code : p.code) ?? null : null;
    subscription = {
      id: raw.id,
      status: raw.status,
      trial_ends_at: raw.trial_ends_at,
      plan_code,
      payment_status: raw.payment_status,
      current_period_end: raw.current_period_end,
    };
  }

  const { data: devRows } = await supabase
    .from("shop_devices")
    .select("id,shop_id,device_fingerprint,label,platform,app_version,last_seen_at,is_active,trusted,suspicious_flag,created_at")
    .eq("shop_id", shopId)
    .order("last_seen_at", { ascending: false })
    .limit(50);

  const devices = (devRows ?? []) as unknown as ShopDeviceRow[];

  return {
    shop: {
      id: shop.id as string,
      name: (shop.name as string) ?? "—",
      district: (shop.district as string) ?? null,
      city: (shop.city as string) ?? null,
      is_active: Boolean(shop.is_active),
      organization_id: orgId,
      last_seen_at: (shop.last_seen_at as string) ?? null,
      phone_e164: (shop.phone_e164 as string) ?? null,
      created_at: (shop.created_at as string) ?? null,
      latitude: shop.latitude != null ? Number(shop.latitude) : null,
      longitude: shop.longitude != null ? Number(shop.longitude) : null,
    },
    owner_label: null,
    owner_email: null,
    product_count: 0,
    sale_count_30d: 0,
    last_sale_at: null,
    subscription,
    plan_code,
    devices,
    sync_health: null,
    subscriptionPaymentsRecent: [],
  };
}

export async function adminSetShopActive(shopId: string, active: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_set_shop_active", {
    p_shop_id: shopId,
    p_active: active,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminExtendSubscriptionTrial(
  subscriptionId: string,
  extraDays: number,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_extend_subscription_trial", {
    p_subscription_id: subscriptionId,
    p_extra_days: extraDays,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminSubscriptionSetPlan(
  subscriptionId: string,
  planCode: AdminPlanCode,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_subscription_set_plan", {
    p_subscription_id: subscriptionId,
    p_plan_code: planCode,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminShopSetSubscriptionPlan({
  shopId,
  planCode,
  days,
}: {
  shopId: string;
  planCode: AdminPlanCode;
  days: number;
}): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_shop_set_subscription_plan", {
    p_shop_id: shopId,
    p_plan_code: planCode,
    p_days: Math.max(1, Math.floor(days || 30)),
  });
  if (error) {
    const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
    return {
      ok: false,
      message: missingFn
        ? "Admin VIP function is missing on Supabase. Apply migration 043_repair_admin_shop_plan_rpc.sql, then reload the app."
        : error.message,
    };
  }
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok === true) return { ok: true };
  return { ok: false, message: j.error ?? "Plan could not be changed." };
}

export async function adminSubscriptionSetStatus(
  subscriptionId: string,
  status: "trial" | "trialing" | "active" | "expired" | "past_due" | "cancelled" | "paused",
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_subscription_set_status", {
    p_subscription_id: subscriptionId,
    p_status: status,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminSubscriptionMarkPayment(
  subscriptionId: string,
  amountUgx: number,
  note?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_subscription_mark_payment", {
    p_subscription_id: subscriptionId,
    p_amount_ugx: Math.max(0, Math.floor(amountUgx)),
    p_note: note ?? null,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminShopResetSync(shopId: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_shop_reset_sync", { p_shop_id: shopId });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminShopForceLogoutDevices(shopId: string): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_shop_force_logout_devices", { p_shop_id: shopId });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminShopDeviceSetActive(
  deviceId: string,
  active: boolean,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_shop_device_set_active", {
    p_device_id: deviceId,
    p_active: active,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminShopDeviceSetTrusted(
  deviceId: string,
  trusted: boolean,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { error } = await supabase.rpc("admin_shop_device_set_trusted", {
    p_device_id: deviceId,
    p_trusted: trusted,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function adminShopOpenSupportMessage(
  shopId: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; message?: string; id?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_shop_open_support_message", {
    p_shop_id: shopId,
    p_subject: subject,
    p_body: body,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data as string | undefined };
}

export function whatsappUrlFromPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return `https://wa.me/${digits.startsWith("0") ? "256" + digits.slice(1) : digits}`;
}

export async function fetchDistrictOpsTable(): Promise<DistrictOpsRow[]> {
  if (!supabase) return [];
  const [{ data: districts }, { data: shops }, { data: assigns }, dayStart, { data: paidSubs }] = await Promise.all([
    supabase.from("districts").select("id, name").order("sort_order", { ascending: true }),
    supabase.from("shops").select("id, organization_id, district_id, district, city, is_active, last_seen_at"),
    supabase.from("admin_assignments").select("district_id").not("district_id", "is", null),
    Promise.resolve(kampalaDayStartIso()),
    supabase.from("subscriptions").select("organization_id").eq("status", "active"),
  ]);

  const paidOrgIds = new Set((paidSubs ?? []).map((r) => r.organization_id as string).filter(Boolean));

  const agentByDistrict = new Map<string, number>();
  for (const a of assigns ?? []) {
    const did = a.district_id as string;
    if (!did) continue;
    agentByDistrict.set(did, (agentByDistrict.get(did) ?? 0) + 1);
  }

  const rows: DistrictOpsRow[] = (districts ?? []).map((d) => {
    const id = d.id as string;
    let totalShops = 0;
    let activeToday = 0;
    let paidShops = 0;
    for (const sh of shops ?? []) {
      const match =
        (sh.district_id as string | null) === id ||
        String(sh.district ?? "")
          .toLowerCase()
          .includes(String(d.name ?? "").toLowerCase());
      if (!match) continue;
      totalShops += 1;
      const ls = sh.last_seen_at as string | null;
      if (ls && ls >= dayStart) activeToday += 1;
      const oid = sh.organization_id as string;
      if (oid && paidOrgIds.has(oid)) paidShops += 1;
    }
    return {
      districtId: id,
      label: (d.name as string) ?? "—",
      totalShops,
      activeToday,
      paidShops,
      fieldAgentsAssigned: agentByDistrict.get(id) ?? 0,
    };
  });

  rows.sort((a, b) => b.totalShops - a.totalShops);
  return rows;
}

export async function fetchBusinessTypeSlices(): Promise<BusinessTypeSlice[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("shops").select("business_type");
  if (error || !data) return [];
  const m = new Map<string, number>();
  for (const r of data) {
    const t = (r.business_type as string) || "other";
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/** Shop rows created per local Kampala calendar day (last 7 days). */
export async function fetchShopSignupBuckets7d(): Promise<DayBucket[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("shops").select("created_at").order("created_at", { ascending: false }).limit(800);
  if (error || !data) return [];

  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(d);
    labels.push(key);
  }
  const counts = new Map(labels.map((k) => [k, 0] as [string, number]));
  for (const r of data) {
    const raw = r.created_at as string;
    if (!raw) continue;
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(new Date(raw));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return labels.map((label) => ({ label: label.slice(5), count: counts.get(label) ?? 0 }));
}

export async function fetchSubscriptionGrowthBuckets7d(): Promise<DayBucket[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("subscriptions").select("created_at").order("created_at", { ascending: false }).limit(800);
  if (error || !data) return [];
  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(d));
  }
  const counts = new Map(labels.map((k) => [k, 0] as [string, number]));
  for (const r of data) {
    const raw = r.created_at as string;
    if (!raw) continue;
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(new Date(raw));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return labels.map((label) => ({ label: label.slice(5), count: counts.get(label) ?? 0 }));
}

/** Completed sales total UGX per Kampala calendar day (last 7 days). */
export async function fetchSalesVolumeBuckets7d(): Promise<DayBucket[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("sales")
    .select("completed_at, total_ugx")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(2500);
  if (error || !data) return [];

  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(d));
  }
  const sums = new Map(labels.map((k) => [k, 0] as [string, number]));
  for (const r of data) {
    const raw = r.completed_at as string;
    if (!raw) continue;
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala" }).format(new Date(raw));
    if (!sums.has(key)) continue;
    sums.set(key, (sums.get(key) ?? 0) + (Number(r.total_ugx) || 0));
  }
  return labels.map((label) => ({ label: label.slice(5), count: sums.get(label) ?? 0 }));
}

export type OrgBillingOfferStaffRow = {
  id: string;
  organization_id: string;
  shop_id: string | null;
  amount_ugx: number;
  currency: string;
  message: string | null;
  status: string;
  created_at: string;
};

export async function fetchOrgBillingOffersForQueue(limit = 80): Promise<OrgBillingOfferStaffRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("org_billing_offers")
    .select("id, organization_id, shop_id, amount_ugx, currency, message, status, created_at")
    .in("status", ["pending", "claimed_paid"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as OrgBillingOfferStaffRow[];
}

export async function internalOpsOrgBillingOfferSend(
  organizationId: string,
  amountUgx: number,
  message?: string | null,
  shopId?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_org_billing_offer_send", {
    p_organization_id: organizationId,
    p_amount_ugx: amountUgx,
    p_message: message ?? null,
    p_shop_id: shopId ?? null,
  });
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not send offer." };
}

export async function internalOpsOrgBillingOfferFulfill(
  offerId: string,
  note?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("internal_ops_org_billing_offer_fulfill", {
    p_offer_id: offerId,
    p_note: note ?? null,
  });
  if (error) return { ok: false, message: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string };
  if (j.ok) return { ok: true };
  return { ok: false, message: j.error ?? "Could not fulfill offer." };
}
