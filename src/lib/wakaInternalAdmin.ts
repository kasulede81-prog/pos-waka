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

export type InternalDashboardStats = {
  totalShops: number;
  activeToday: number;
  trialSubscriptions: number;
  paidSubscriptions: number;
  expiredSubscriptions: number;
  salesTotalUgx: number | null;
  shopsByDistrict: { label: string; count: number }[];
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

export async function fetchInternalDashboardStats(): Promise<InternalDashboardStats | null> {
  if (!supabase) return null;

  const dayStart = kampalaDayStartIso();

  const [
    shopsAll,
    shopsActive,
    subsTrial,
    subsPaid,
    subsExpired,
    shopsDistrict,
    salesRpc,
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
  ]);

  if (
    shopsAll.error ||
    shopsActive.error ||
    shopsDistrict.error ||
    subsTrial.error ||
    subsPaid.error ||
    subsExpired.error
  ) {
    return null;
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

  return {
    totalShops: shopsAll.count ?? 0,
    activeToday: shopsActive.count ?? 0,
    trialSubscriptions: subsTrial.count ?? 0,
    paidSubscriptions: subsPaid.count ?? 0,
    expiredSubscriptions: subsExpired.count ?? 0,
    salesTotalUgx,
    shopsByDistrict,
  };
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
};

export type SupportTicketRow = {
  id: string;
  subject: string | null;
  body: string | null;
  status: string;
  priority: string;
  channel: string;
  created_at: string;
  shop_name: string | null;
  shop_district: string | null;
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

export async function fetchSupportTickets(limit = 25): Promise<SupportTicketRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("support_requests")
    .select("id, subject, body, status, priority, channel, created_at, shops ( name, district )")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown> & { shops?: { name?: string; district?: string } | { name?: string; district?: string }[] }>).map(
    (row) => {
      const sh = row.shops;
      const shop = Array.isArray(sh) ? sh[0] : sh;
      return {
        id: row.id as string,
        subject: (row.subject as string) ?? null,
        body: (row.body as string) ?? null,
        status: row.status as string,
        priority: row.priority as string,
        channel: row.channel as string,
        created_at: row.created_at as string,
        shop_name: shop?.name ?? null,
        shop_district: shop?.district ?? null,
      };
    },
  );
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

export async function fetchRecentShops(limit = 20): Promise<RecentShopRow[]> {
  if (!supabase) return [];
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, district, city, is_active, created_at, organization_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !shops?.length) return [];

  const orgIds = [...new Set(shops.map((s) => s.organization_id as string).filter(Boolean))];
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
    const sub = orgToSub.get(s.organization_id as string);
    let plan_code: string | null = null;
    if (sub?.subscription_plans) {
      const p = sub.subscription_plans;
      plan_code = (Array.isArray(p) ? p[0]?.code : p.code) ?? null;
    }
    const trial_days_left = sub ? trialDaysLeft(sub.trial_ends_at, sub.status) : null;
    return {
      id: s.id as string,
      name: (s.name as string) ?? "—",
      district: (s.district as string) ?? null,
      city: (s.city as string) ?? null,
      is_active: Boolean(s.is_active),
      created_at: (s.created_at as string) ?? "",
      plan_code,
      trial_days_left,
    };
  });
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
