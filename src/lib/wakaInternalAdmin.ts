import { supabase } from "./supabase";

export type WakaInternalAdminRow = {
  id: string;
  role: string;
  assigned_district_ids: string[] | null;
  active: boolean;
  max_shops: number | null;
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
    role: string;
    assigned_district_ids: string[] | null;
    active: boolean;
    max_shops: number | null;
  };
  return {
    id: r.id,
    role: r.role,
    assigned_district_ids: r.assigned_district_ids,
    active: r.active,
    max_shops: r.max_shops,
  };
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
