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
  /** Devices seen in the last 15 minutes. */
  activeDevices: number;
  /** Shops with last_seen in the last 15 minutes (real-time). */
  shopsOnlineNow: number;
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
    shopsOnlineNow: Number(j.shops_online_now ?? j.active_today ?? 0),
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
  const onlineCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const [
    shopsAll,
    shopsActive,
    shopsOnlineNow,
    subsTrial,
    subsPaid,
    subsExpired,
    shopsDistrict,
    salesRpc,
    lapsed,
    exp7,
    devCount,
    devOnlineCount,
    supOpen,
  ] = await Promise.all([
    supabase.from("shops").select("id", { count: "exact", head: true }),
    supabase.from("shops").select("id", { count: "exact", head: true }).gte("last_seen_at", dayStart),
    supabase.from("shops").select("id", { count: "exact", head: true }).gte("last_seen_at", onlineCutoff),
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
    supabase
      .from("shop_devices")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .gte("last_seen_at", onlineCutoff),
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

  const devFallback = devOnlineCount.error ? await supabase.from("shops").select("active_device_count") : null;
  const activeDevices =
    devOnlineCount.error || devOnlineCount.count === null
      ? devCount.error || devCount.count === null
        ? (devFallback?.data ?? []).reduce((s, r) => s + (Number((r as { active_device_count?: number }).active_device_count) || 0), 0)
        : (devCount.count ?? 0)
      : (devOnlineCount.count ?? 0);

  return {
    ok: true,
    stats: {
      totalShops: shopsAll.count ?? 0,
      activeToday: shopsActive.count ?? 0,
      shopsOnlineNow: shopsOnlineNow.error ? (shopsActive.count ?? 0) : (shopsOnlineNow.count ?? 0),
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
  if (!e || e.endsWith("@login.waka.ug")) return null;
  return e;
}

const UUID_LABEL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Human-readable owner line for internal admin — never show raw auth user UUIDs. */
export function formatOwnerDisplayLabel(input: {
  ownerLabel?: string | null;
  ownerEmail?: string | null;
  ownerFullName?: string | null;
}): string | null {
  const email = formatDisplayEmail(input.ownerEmail);
  const fullName = (input.ownerFullName ?? "").trim();
  if (fullName && !UUID_LABEL_RE.test(fullName)) return fullName;
  const label = (input.ownerLabel ?? "").trim();
  if (label && !UUID_LABEL_RE.test(label)) return label;
  return email;
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

export { ADMIN_PLAN_CODES, type AdminPlanCode } from "./subscriptionEngine";

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
  shop_number?: string | null;
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
  owner_full_name?: string | null;
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

export type AdminShopProductRow = {
  id: string;
  name: string;
  category: string | null;
  selling_price_ugx: number | null;
  stock_quantity: number | null;
  is_active: boolean;
  updated_at: string | null;
};

export type ShopOpsDetail = {
  shop: {
    id: string;
    shop_number?: string | null;
    name: string;
    district: string | null;
    district_id: string | null;
    city: string | null;
    area: string | null;
    address_line: string | null;
    business_type: string | null;
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
  owner_full_name?: string | null;
  product_count: number;
  sale_count_30d: number;
  product_count_table?: number;
  product_count_snapshot?: number;
  sales_in_snapshot?: number;
  cloud_snapshot_at?: string | null;
  cloud_snapshot_bytes?: number | null;
  products_preview?: AdminShopProductRow[];
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
  diagnostics_json: Record<string, unknown> | null;
  screenshot_meta: Record<string, unknown> | null;
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
  last_login_at?: string | null;
  device_authority?: "primary" | "secondary" | null;
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
    diagnostics_json:
      row.diagnostics_json && typeof row.diagnostics_json === "object"
        ? (row.diagnostics_json as Record<string, unknown>)
        : null,
    screenshot_meta:
      row.screenshot_meta && typeof row.screenshot_meta === "object"
        ? (row.screenshot_meta as Record<string, unknown>)
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
  let tickets: SupportTicketRow[] = [];
  if (!error && rows.length) {
    tickets = rows.map((row) => mapSupportRpcRow(row));
  } else {
    const { data: fallback, error: fbErr } = await supabase
      .from("support_requests")
      .select(
        "id, subject, body, status, priority, channel, created_at, contact_phone_e164, issue_type, app_version, device_fingerprint, diagnostics_json, screenshot_meta, sync_health_snapshot, shops ( id, name, district, phone_e164 )",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (fbErr || !fallback) return [];
    tickets = (fallback as Array<Record<string, unknown> & { shops?: { id?: string; name?: string; district?: string; phone_e164?: string }[] }>).map(
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
          issue_type: row.issue_type ?? null,
          device_fingerprint: row.device_fingerprint ?? null,
          app_version: row.app_version ?? null,
          sync_health_snapshot: row.sync_health_snapshot ?? {},
          assigned_internal_admin_id: null,
          assigned_admin_email: null,
        });
      },
    );
  }

  const needsDiagnostics = tickets.some((t) => !t.diagnostics_json && t.id);
  if (!needsDiagnostics) return tickets;

  const ids = tickets.filter((t) => !t.diagnostics_json).map((t) => t.id);
  const { data: diagRows } = await supabase
    .from("support_requests")
    .select("id, diagnostics_json, screenshot_meta, issue_type")
    .in("id", ids);
  if (!diagRows?.length) return tickets;

  const byId = new Map(diagRows.map((r) => [String(r.id), r]));
  return tickets.map((t) => {
    const extra = byId.get(t.id);
    if (!extra) return t;
    return {
      ...t,
      diagnostics_json:
        extra.diagnostics_json && typeof extra.diagnostics_json === "object"
          ? (extra.diagnostics_json as Record<string, unknown>)
          : t.diagnostics_json,
      screenshot_meta:
        extra.screenshot_meta && typeof extra.screenshot_meta === "object"
          ? (extra.screenshot_meta as Record<string, unknown>)
          : t.screenshot_meta,
      issue_type: t.issue_type ?? (extra.issue_type != null ? String(extra.issue_type) : null),
    };
  });
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
  shop_number?: string | null;
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
      shop_number: s.shop_number ?? null,
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
    shop_number: row.shop_number != null ? String(row.shop_number) : null,
    name: (row.name as string) ?? "—",
    district: (row.district as string) ?? null,
    city: (row.city as string) ?? null,
    is_active: Boolean(row.is_active),
    created_at: (row.created_at as string) ?? "",
    plan_code: (row.plan_code as string) ?? null,
    trial_days_left: trialDaysLeft(trialEnds, status),
    owner_label: (row.owner_label as string) ?? null,
    owner_email: formatDisplayEmail(row.owner_email as string) ?? null,
    owner_full_name: (row.owner_full_name as string) ?? null,
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
  const { data: rpcRows, error: rpcError } = await supabase.rpc("internal_ops_shops_by_signup", { p_limit: cap });
  if (!rpcError && rpcRows && Array.isArray(rpcRows)) {
    return (rpcRows as Array<Record<string, unknown>>).map((row) => mapRecentShopRpcRow(row));
  }
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, shop_number, name, district, city, is_active, created_at, organization_id, last_seen_at")
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error || !shops?.length) return [];
  return enrichRecentShopRows(shops as RecentShopDbRow[]);
}

export async function fetchRecentShops(limit = 20): Promise<RecentShopRow[]> {
  if (!supabase) return [];

  const { data: rpcRows, error: rpcError } = await supabase.rpc("internal_ops_recent_shops", { p_limit: limit });
  if (!rpcError && rpcRows && Array.isArray(rpcRows)) {
    return (rpcRows as Array<Record<string, unknown>>).map((row) => mapRecentShopRpcRow(row));
  }

  return fetchShopsBySignupDate(limit);
}

function mapProductsPreview(raw: unknown): AdminShopProductRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const p = row as Record<string, unknown>;
      if (!p.id || !p.name) return null;
      return {
        id: String(p.id),
        name: String(p.name),
        category: p.category != null ? String(p.category) : null,
        selling_price_ugx: p.selling_price_ugx != null ? Number(p.selling_price_ugx) : null,
        stock_quantity: p.stock_quantity != null ? Number(p.stock_quantity) : null,
        is_active: p.is_active !== false,
        updated_at: p.updated_at != null ? String(p.updated_at) : null,
      } satisfies AdminShopProductRow;
    })
    .filter((x): x is AdminShopProductRow => x != null);
}

async function fillShopOpsMetricsFallback(shopId: string, detail: ShopOpsDetail): Promise<ShopOpsDetail> {
  if (!supabase) return detail;
  const needsProducts = detail.product_count === 0 && (detail.products_preview?.length ?? 0) === 0;
  const needsSales = detail.sale_count_30d === 0;
  if (!needsProducts && !needsSales) return detail;

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [prodHead, salesHead] = await Promise.all([
    needsProducts
      ? supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("is_active", true)
      : Promise.resolve({ count: detail.product_count, error: null }),
    needsSales
      ? supabase
          .from("sales")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("status", "completed")
          .gte("created_at", since)
      : Promise.resolve({ count: detail.sale_count_30d, error: null }),
  ]);

  let products_preview = detail.products_preview ?? [];
  if (needsProducts && !prodHead.error && (prodHead.count ?? 0) > 0 && products_preview.length === 0) {
    const { data: rows } = await supabase
      .from("products")
      .select("id, name, selling_price_per_unit_ugx, stock_on_hand, is_active, updated_at, metadata, product_categories ( name )")
      .eq("shop_id", shopId)
      .order("updated_at", { ascending: false })
      .limit(80);
    products_preview = (rows ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const catJoin = r.product_categories as { name?: string } | { name?: string }[] | null;
      const catName = Array.isArray(catJoin) ? catJoin[0]?.name : catJoin?.name;
      const meta = r.metadata as Record<string, unknown> | null;
      return {
        id: String(r.id),
        name: String(r.name ?? "—"),
        category: catName ?? (meta?.category != null ? String(meta.category) : null),
        selling_price_ugx: r.selling_price_per_unit_ugx != null ? Number(r.selling_price_per_unit_ugx) : null,
        stock_quantity: r.stock_on_hand != null ? Number(r.stock_on_hand) : null,
        is_active: r.is_active !== false,
        updated_at: r.updated_at != null ? String(r.updated_at) : null,
      } satisfies AdminShopProductRow;
    });
  }

  return {
    ...detail,
    product_count: Math.max(detail.product_count, prodHead.count ?? 0),
    product_count_table: prodHead.count ?? detail.product_count_table ?? detail.product_count,
    sale_count_30d: Math.max(detail.sale_count_30d, salesHead.count ?? 0),
    products_preview,
  };
}

export async function resolveShopIdForAdmin(shopNumberOrUuid: string): Promise<string | null> {
  if (!supabase) return null;
  const { normalizeShopLookupInput } = await import("./shopNumber");
  const parsed = normalizeShopLookupInput(shopNumberOrUuid);
  if (!parsed) return null;
  if (parsed.kind === "uuid") return parsed.value;
  const { data, error } = await supabase.rpc("resolve_shop_id_by_number", { p_shop_number: parsed.value });
  if (error || !data) return null;
  return String(data);
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
          last_login_at: (d.last_login_at as string) ?? null,
          device_authority:
            d.device_authority === "primary" || d.device_authority === "secondary"
              ? d.device_authority
              : null,
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
    return fillShopOpsMetricsFallback(shopId, {
      shop: {
        id: shopRaw.id as string,
        shop_number: shopRaw.shop_number != null ? String(shopRaw.shop_number) : null,
        name: (shopRaw.name as string) ?? "—",
        district: (shopRaw.district as string) ?? null,
        district_id: (shopRaw.district_id as string) ?? null,
        city: (shopRaw.city as string) ?? null,
        area: (shopRaw.area as string) ?? null,
        address_line: (shopRaw.address_line as string) ?? null,
        business_type: (shopRaw.business_type as string) ?? null,
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
      owner_full_name: (j.owner_full_name as string) ?? null,
      product_count: Number(j.product_count ?? 0),
      sale_count_30d: Number(j.sale_count_30d ?? 0),
      product_count_table: j.product_count_table != null ? Number(j.product_count_table) : undefined,
      product_count_snapshot: j.product_count_snapshot != null ? Number(j.product_count_snapshot) : undefined,
      sales_in_snapshot: j.sales_in_snapshot != null ? Number(j.sales_in_snapshot) : undefined,
      cloud_snapshot_at: (j.cloud_snapshot_at as string) ?? null,
      cloud_snapshot_bytes: j.cloud_snapshot_bytes != null ? Number(j.cloud_snapshot_bytes) : null,
      products_preview: mapProductsPreview(j.products_preview),
      last_sale_at: (j.last_sale_at as string) ?? null,
      subscription,
      plan_code: (j.plan_code as string) ?? null,
      devices,
      sync_health,
      subscriptionPaymentsRecent,
    });
  }

  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select(
      "id, name, district, district_id, city, area, address_line, business_type, is_active, organization_id, last_seen_at, phone_e164, created_at, latitude, longitude",
    )
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
    .select(
      "id,shop_id,device_fingerprint,label,platform,app_version,last_seen_at,last_login_at,device_authority,is_active,trusted,suspicious_flag,created_at",
    )
    .eq("shop_id", shopId)
    .order("last_seen_at", { ascending: false })
    .limit(50);

  const devices = (devRows ?? []) as unknown as ShopDeviceRow[];

  return fillShopOpsMetricsFallback(shopId, {
    shop: {
      id: shop.id as string,
      shop_number: (shop as { shop_number?: string }).shop_number ?? null,
      name: (shop.name as string) ?? "—",
      district: (shop.district as string) ?? null,
      district_id: (shop.district_id as string) ?? null,
      city: (shop.city as string) ?? null,
      area: (shop.area as string) ?? null,
      address_line: (shop.address_line as string) ?? null,
      business_type: (shop.business_type as string) ?? null,
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
    owner_full_name: null,
    product_count: 0,
    sale_count_30d: 0,
    last_sale_at: null,
    subscription,
    plan_code,
    devices,
    sync_health: null,
    subscriptionPaymentsRecent: [],
  });
}

export type AdminShopProfileUpdateInput = {
  shopId: string;
  shopName: string;
  phoneE164?: string | null;
  ownerEmail?: string | null;
  ownerFullName?: string | null;
  districtId?: string | null;
  addressLine?: string | null;
  city?: string | null;
  area?: string | null;
  businessType?: string | null;
  note?: string | null;
};

export async function adminPermanentlyDeleteShopAccount(
  shopId: string,
  confirmation: string,
): Promise<{ ok: boolean; message?: string; partial?: boolean; sales_deleted?: number }> {
  const { invokeSupabaseEdgeFunction } = await import("./supabaseEdgeInvoke");
  const r = await invokeSupabaseEdgeFunction<{
    ok?: boolean;
    error?: string;
    detail?: string;
    message?: string;
    partial?: boolean;
    sales_deleted?: number;
  }>("admin-permanently-delete-shop-account", {
    shop_id: shopId,
    confirmation: confirmation.trim(),
  });

  if (!r.ok) {
    return { ok: false, message: r.message };
  }

  const j = r.data as {
    ok?: boolean;
    error?: string;
    detail?: string;
    message?: string;
    partial?: boolean;
    sales_deleted?: number;
  };

  if (j.ok) {
    return {
      ok: true,
      message: j.message ?? "Account permanently deleted.",
      sales_deleted: j.sales_deleted,
    };
  }

  if (j.error === "forbidden") return { ok: false, message: j.detail ?? "Super admin only." };
  if (j.error === "confirmation_required") {
    return { ok: false, message: j.detail ?? "Confirmation text did not match." };
  }
  if (j.error === "cannot_delete_self") return { ok: false, message: "You cannot delete your own account." };
  if (j.error === "cannot_delete_internal_admin") {
    return { ok: false, message: "Cannot delete a Waka internal admin account." };
  }
  if (j.error === "auth_delete_failed" || j.partial) {
    return {
      ok: false,
      partial: true,
      message:
        j.message ??
        j.detail ??
        "Shop data was removed but the login user still exists. They cannot register again until you delete them in Supabase Auth → Users (or retry permanent delete).",
    };
  }

  return {
    ok: false,
    message: j.detail ?? j.message ?? j.error ?? "Permanent delete failed.",
    partial: j.partial,
  };
}

export async function adminShopUpdateProfile(
  input: AdminShopProfileUpdateInput,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Supabase is not configured." };

  const { normalizeUgPhoneE164 } = await import("./businessProfile");
  let phone: string | null = null;
  if (input.phoneE164?.trim()) {
    phone = normalizeUgPhoneE164(input.phoneE164);
    if (!phone) return { ok: false, message: "Invalid Uganda phone number." };
  }

  const { data, error } = await supabase.rpc("admin_shop_update_profile", {
    p_shop_id: input.shopId,
    p_shop_name: input.shopName.trim(),
    p_phone_e164: phone,
    p_owner_email: input.ownerEmail?.trim().toLowerCase() || null,
    p_owner_full_name: input.ownerFullName?.trim() || null,
    p_district_id: input.districtId || null,
    p_address_line: input.addressLine?.trim() || null,
    p_city: input.city?.trim() || null,
    p_area: input.area?.trim() || null,
    p_business_type: input.businessType || null,
    p_note: input.note?.trim() || null,
  });

  if (error) {
    return {
      ok: false,
      message: error.message.includes("admin_shop_update_profile")
        ? "Apply migration 050_admin_shop_profile_override.sql on Supabase."
        : error.message,
    };
  }

  const j = (data ?? {}) as { ok?: boolean; error?: string; detail?: string };
  if (j.ok) return { ok: true };
  if (j.error === "phone_in_use") return { ok: false, message: j.detail ?? "Phone already on another account." };
  if (j.error === "email_in_use") return { ok: false, message: j.detail ?? "Email already on another account." };
  if (j.error === "invalid_phone") return { ok: false, message: "Invalid Uganda phone number." };
  if (j.error === "invalid_email") return { ok: false, message: "Enter a valid owner email (not phone-login)." };
  return { ok: false, message: j.detail ?? j.error ?? "Could not update shop profile." };
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

export async function adminShopResetBackOfficePin(
  shopId: string,
): Promise<{ ok: boolean; message?: string; clearedAt?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_shop_reset_backoffice_pin", { p_shop_id: shopId });
  if (error) {
    const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
    return {
      ok: false,
      message: missingFn
        ? "Missing RPC: admin_shop_reset_backoffice_pin. Add DB function and retry."
        : error.message,
    };
  }
  const j = (data ?? {}) as { ok?: boolean; error?: string; clear_back_office_pin_at?: string };
  if (j.ok === true) {
    return { ok: true, clearedAt: j.clear_back_office_pin_at };
  }
  return { ok: false, message: j.error ?? "Could not reset back office PIN." };
}

/** Support: set owner auth password directly (edge function + service role). */
export async function adminShopSetOwnerPasswordDirect(
  shopId: string,
  newPassword: string,
): Promise<{ ok: boolean; message?: string }> {
  const { invokeSupabaseEdgeFunction } = await import("./supabaseEdgeInvoke");
  const r = await invokeSupabaseEdgeFunction<{ ok?: boolean; error?: string; detail?: string }>(
    "admin-set-owner-password",
    { shop_id: shopId, new_password: newPassword },
  );
  if (!r.ok) return { ok: false, message: r.message };
  const j = r.data;
  if (j.ok) return { ok: true };
  const err = j.error ?? "password_update_failed";
  if (err === "forbidden") {
    return { ok: false, message: j.detail ?? "Your admin role cannot set passwords." };
  }
  if (err === "owner_not_found") return { ok: false, message: "Shop owner account not found." };
  if (err === "password_too_short") return { ok: false, message: "Password must be at least 8 characters." };
  return { ok: false, message: j.detail ?? err };
}

export async function adminShopSendOwnerPasswordReset(
  shopId: string,
): Promise<{ ok: boolean; message?: string; ownerEmail?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_shop_send_owner_password_reset", { p_shop_id: shopId });
  if (error) {
    const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
    return {
      ok: false,
      message: missingFn
        ? "Missing RPC: admin_shop_send_owner_password_reset. Add DB function and retry."
        : error.message,
    };
  }
  const j = (data ?? {}) as { ok?: boolean; error?: string; owner_email?: string };
  if (j.ok === true) {
    return { ok: true, ownerEmail: String(j.owner_email ?? "").trim() || undefined };
  }
  if (j.error === "owner_email_missing") {
    return {
      ok: false,
      message: "Owner has no email on profile or auth account. Use “Set owner login password” on Support instead.",
    };
  }
  return { ok: false, message: j.error ?? "Could not send password reset." };
}

export function whatsappUrlFromPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return `https://wa.me/${digits.startsWith("0") ? "256" + digits.slice(1) : digits}`;
}

export async function fetchDistrictOpsTable(): Promise<DistrictOpsRow[]> {
  if (!supabase) return [];
  const [{ data: districts, error: districtsErr }, { data: shops, error: shopsErr }, { data: assigns }, dayStart, { data: paidSubs }] = await Promise.all([
    supabase.from("districts").select("id, name").order("sort_order", { ascending: true }),
    supabase.from("shops").select("id, organization_id, district_id, district, city, is_active, last_seen_at"),
    supabase.from("admin_assignments").select("district_id").not("district_id", "is", null),
    Promise.resolve(kampalaDayStartIso()),
    supabase.from("subscriptions").select("organization_id").eq("status", "active"),
  ]);

  if (shopsErr || !shops) return [];

  const paidOrgIds = new Set((paidSubs ?? []).map((r) => r.organization_id as string).filter(Boolean));

  const agentByDistrict = new Map<string, number>();
  for (const a of assigns ?? []) {
    const did = a.district_id as string;
    if (!did) continue;
    agentByDistrict.set(did, (agentByDistrict.get(did) ?? 0) + 1);
  }

  const districtRows = !districtsErr && Array.isArray(districts) ? districts : [];
  const rowsByKey = new Map<string, DistrictOpsRow>();
  const ensureRow = (districtId: string | null, label: string): DistrictOpsRow => {
    const key = districtId ?? `label:${label.toLowerCase()}`;
    const existing = rowsByKey.get(key);
    if (existing) return existing;
    const created: DistrictOpsRow = {
      districtId,
      label: label || "—",
      totalShops: 0,
      activeToday: 0,
      paidShops: 0,
      fieldAgentsAssigned: districtId ? (agentByDistrict.get(districtId) ?? 0) : 0,
    };
    rowsByKey.set(key, created);
    return created;
  };

  for (const d of districtRows) {
    const id = (d.id as string) ?? null;
    const label = ((d.name as string) ?? "").trim() || "—";
    ensureRow(id, label);
  }

  for (const sh of shops) {
    const districtId = (sh.district_id as string | null) ?? null;
    const districtLabel = String((sh.district as string | null) ?? "").trim() || "Unassigned";
    let target: DistrictOpsRow | null = null;
    if (districtId) {
      target = ensureRow(districtId, districtLabel);
    } else if (districtRows.length > 0) {
      const match = districtRows.find((d) =>
        districtLabel.toLowerCase().includes(String(d.name ?? "").toLowerCase()),
      );
      if (match) {
        target = ensureRow(match.id as string, (match.name as string) ?? districtLabel);
      }
    }
    if (!target) target = ensureRow(null, districtLabel);
    target.totalShops += 1;
    const ls = sh.last_seen_at as string | null;
    if (ls && ls >= dayStart) target.activeToday += 1;
    const oid = sh.organization_id as string;
    if (oid && paidOrgIds.has(oid)) target.paidShops += 1;
  }

  const rows = [...rowsByKey.values()];

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

export type FleetDeviceRow = ShopDeviceRow & {
  shop_name: string;
  shop_district: string | null;
  shop_active: boolean;
  shop_last_seen_at: string | null;
  pending_sync: number;
};

/** Fleet-wide devices for internal ops (RLS: is_waka_internal_staff). */
export async function fetchFleetDevices(limit = 120): Promise<FleetDeviceRow[]> {
  if (!supabase) return [];
  const cap = Math.min(Math.max(limit, 1), 200);
  const { data: devices, error } = await supabase
    .from("shop_devices")
    .select("id, shop_id, device_fingerprint, label, platform, app_version, last_seen_at, is_active, trusted, suspicious_flag, created_at")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(cap);
  if (error || !devices?.length) return [];

  const shopIds = [...new Set(devices.map((d) => d.shop_id as string))];
  const shopMap = new Map<string, { name: string; district: string | null; is_active: boolean; last_seen_at: string | null }>();
  const syncMap = new Map<string, number>();

  const [shopsRes, syncRes] = await Promise.all([
    supabase.from("shops").select("id, name, district, is_active, last_seen_at").in("id", shopIds.slice(0, 100)),
    supabase.from("sync_health").select("shop_id, pending_outbound").in("shop_id", shopIds.slice(0, 100)),
  ]);

  for (const s of shopsRes.data ?? []) {
    shopMap.set(s.id as string, {
      name: (s.name as string) ?? "Shop",
      district: (s.district as string) ?? null,
      is_active: Boolean(s.is_active),
      last_seen_at: (s.last_seen_at as string) ?? null,
    });
  }
  for (const row of syncRes.data ?? []) {
    syncMap.set(row.shop_id as string, Number(row.pending_outbound ?? 0));
  }

  return devices.map((r) => {
    const shopId = r.shop_id as string;
    const shop = shopMap.get(shopId);
    return {
      id: r.id as string,
      shop_id: shopId,
      device_fingerprint: (r.device_fingerprint as string) ?? "",
      label: (r.label as string) ?? null,
      platform: (r.platform as string) ?? null,
      app_version: (r.app_version as string) ?? null,
      last_seen_at: (r.last_seen_at as string) ?? null,
      is_active: Boolean(r.is_active),
      trusted: Boolean(r.trusted),
      suspicious_flag: Boolean(r.suspicious_flag),
      created_at: (r.created_at as string) ?? "",
      shop_name: shop?.name ?? "Shop",
      shop_district: shop?.district ?? null,
      shop_active: shop?.is_active ?? true,
      shop_last_seen_at: shop?.last_seen_at ?? null,
      pending_sync: syncMap.get(shopId) ?? 0,
    };
  });
}

export type OpsAuditRow = {
  id: string;
  actor: string | null;
  action: string;
  target_shop_id: string | null;
  target_org_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

/** Admin owner password recovery actions (ops + shop audit_logs). */
export const ADMIN_PASSWORD_RESET_AUDIT_ACTIONS = [
  "admin_request_owner_password_reset",
  "admin_set_owner_password",
  "admin_password_reset_email_sent",
  "admin_password_reset_email_failed",
] as const;

function auditLogRowToOpsRow(row: {
  id: string;
  shop_id: string | null;
  actor_user_id: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}): OpsAuditRow {
  return {
    id: row.id,
    actor: row.actor_user_id,
    action: row.action,
    target_shop_id: row.shop_id,
    target_org_id: null,
    payload: row.payload,
    created_at: row.created_at,
  };
}

function mergeOpsAuditRows(rows: OpsAuditRow[], limit: number): OpsAuditRow[] {
  const seen = new Set<string>();
  const unique: OpsAuditRow[] = [];
  for (const row of [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())) {
    const key = `${row.action}:${row.created_at.slice(0, 19)}:${row.target_shop_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  return unique;
}

export async function fetchOpsAuditFeed(limit = 30): Promise<OpsAuditRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("internal_ops_admin_audit")
    .select("id, actor, action, target_shop_id, target_org_id, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 80));
  if (error || !data) return [];
  return data as OpsAuditRow[];
}

/** All admin password reset events (internal ops audit). */
export async function fetchAdminPasswordResetAudit(limit = 50): Promise<OpsAuditRow[]> {
  if (!supabase) return [];
  const cap = Math.min(limit, 100);
  const { data, error } = await supabase
    .from("internal_ops_admin_audit")
    .select("id, actor, action, target_shop_id, target_org_id, payload, created_at")
    .in("action", [...ADMIN_PASSWORD_RESET_AUDIT_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(cap);
  if (error || !data) return [];
  return data as OpsAuditRow[];
}

export async function fetchShopAuditTimeline(shopId: string, limit = 25): Promise<OpsAuditRow[]> {
  if (!supabase) return [];
  const cap = Math.min(limit, 50);
  const [opsRes, shopRes] = await Promise.all([
    supabase
      .from("internal_ops_admin_audit")
      .select("id, actor, action, target_shop_id, target_org_id, payload, created_at")
      .eq("target_shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(cap),
    supabase
      .from("audit_logs")
      .select("id, shop_id, actor_user_id, action, payload, created_at")
      .eq("shop_id", shopId)
      .in("action", [...ADMIN_PASSWORD_RESET_AUDIT_ACTIONS])
      .order("created_at", { ascending: false })
      .limit(cap),
  ]);

  const merged: OpsAuditRow[] = [];
  if (opsRes.data) merged.push(...(opsRes.data as OpsAuditRow[]));
  if (shopRes.data) {
    for (const row of shopRes.data) {
      merged.push(
        auditLogRowToOpsRow({
          id: row.id as string,
          shop_id: row.shop_id as string | null,
          actor_user_id: row.actor_user_id as string | null,
          action: row.action as string,
          payload: (row.payload as Record<string, unknown> | null) ?? null,
          created_at: row.created_at as string,
        }),
      );
    }
  }
  return mergeOpsAuditRows(merged, cap);
}

export async function adminShopLogPasswordResetEmail(
  shopId: string,
  ok: boolean,
  detail?: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: "Offline" };
  const { data, error } = await supabase.rpc("admin_shop_log_password_reset_email", {
    p_shop_id: shopId,
    p_ok: ok,
    p_detail: detail ?? null,
  });
  if (error) {
    const missingFn = error.message?.includes("Could not find the function") || error.code === "PGRST202";
    return {
      ok: false,
      message: missingFn
        ? "Missing RPC: admin_shop_log_password_reset_email. Apply migration 093 and retry."
        : error.message,
    };
  }
  const j = (data ?? {}) as { ok?: boolean };
  return j.ok === true ? { ok: true } : { ok: false, message: "Could not log email delivery." };
}
