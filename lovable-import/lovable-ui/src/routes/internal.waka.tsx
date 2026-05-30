import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, MapPin, LifeBuoy, Users, CreditCard, Store, Activity, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WakaAdminShell } from "@/components/internal/waka-admin-shell";
import { FieldMap, type MapPin as MapPinT } from "@/components/internal/field-map";
import { useWakaInternalMe, canResolveSupport, canManageSubs } from "@/lib/waka-admin";

export const Route = createFileRoute("/internal/waka")({ component: Page });

type Metrics = {
  total_shops: number; active_today: number; paid_subs: number; trial_subs: number;
  sales_ugx: number; open_support: number; pending_annual: number; ended_trials: number;
  expiring_soon: number; active_devices: number; suspended_shops: number;
};

function Page() {
  return <WakaAdminShell activeTab="/internal/waka"><Overview /></WakaAdminShell>;
}

function Overview() {
  const { me } = useWakaInternalMe();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [shops, setShops] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [support, setSupport] = useState<any[]>([]);
  const [annual, setAnnual] = useState<any[]>([]);
  const [subReqs, setSubReqs] = useState<any[]>([]);
  const [pins, setPins] = useState<MapPinT[]>([]);
  const [tick, setTick] = useState(0);
  const [showMore, setShowMore] = useState(false);

  const load = async () => {
    const [m, s, d, sup, ann, sr, mp] = await Promise.all([
      supabase.rpc("internal_ops_dashboard_metrics"),
      supabase.from("waka_shops" as any).select("id,name,city,owner_name,owner_email,plan_code,subscription_status,trial_end_at,gps_lat,gps_lng,is_active,created_at,district_id").order("created_at", { ascending: false }).limit(18),
      supabase.from("waka_districts" as any).select("id,name,region").order("name"),
      supabase.from("waka_support_tickets" as any).select("*").order("created_at", { ascending: false }).limit(80),
      supabase.from("waka_support_tickets" as any).select("*").eq("issue_type", "annual_plan_request").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("waka_subscription_requests" as any).select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("waka_shops" as any).select("id,name,is_active,gps_lat,gps_lng,district_id").not("gps_lat", "is", null).limit(400),
    ]);
    if (m.data) setMetrics(m.data as unknown as Metrics);
    setShops(s.data ?? []);
    setDistricts(d.data ?? []);
    setSupport(sup.data ?? []);
    setAnnual(ann.data ?? []);
    setSubReqs(sr.data ?? []);
    const districtMap = new Map((d.data ?? []).map((x: any) => [x.id, x.name]));
    setPins(((mp.data ?? []) as any[]).map((x) => ({ id: x.id, name: x.name, is_active: x.is_active, gps_lat: Number(x.gps_lat), gps_lng: Number(x.gps_lng), district: districtMap.get(x.district_id) })));
  };

  useEffect(() => { void load(); }, [tick]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30_000); return () => clearInterval(id); }, []);

  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    return hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  }, []);

  const districtRows = useMemo(() => {
    const map = new Map<string, { id: string; name: string; total: number; active: number; paid: number }>();
    districts.forEach((d) => map.set(d.id, { id: d.id, name: d.name, total: 0, active: 0, paid: 0 }));
    // We'd ideally have per-district counts; for now derive from loaded shops sample
    shops.forEach((s) => {
      const row = map.get(s.district_id);
      if (row) { row.total++; if (s.is_active) row.active++; if (s.subscription_status === "active") row.paid++; }
    });
    return Array.from(map.values());
  }, [districts, shops]);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase opacity-80">{new Date().toLocaleDateString("en-UG", { dateStyle: "full" })}</div>
            <div className="mt-1 text-2xl font-black">{greeting}, {me?.full_name?.split(" ")[0] || "admin"}</div>
            <div className="mt-0.5 text-sm opacity-90">{me?.role.replace("_", " ")} · {me?.assigned_districts.length ?? 0} districts</div>
          </div>
          <button onClick={() => setTick((t) => t + 1)} className="rounded-full bg-white/15 p-2 hover:bg-white/25" aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Shortcut cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Shortcut href="#ops-support" Icon={LifeBuoy} label="Support" count={support.length} />
        <Shortcut href="#ops-recent-shops" Icon={Store} label="Shops" count={shops.length} />
        <Shortcut href="#ops-annual-queue" Icon={CreditCard} label="Payments" count={annual.length} />
        <Shortcut href="#ops-districts" Icon={MapPin} label="Districts" count={districts.length} />
      </div>

      {/* Pulse */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wide text-foreground/70">Pulse</h2>
          <button onClick={() => setShowMore((v) => !v)} className="text-xs font-bold text-orange-700">{showMore ? "Less" : "More metrics"}</button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Total shops" value={metrics?.total_shops} />
          <Metric label="Active today" value={metrics?.active_today} />
          <Metric label="Paid subscriptions" value={metrics?.paid_subs} />
          <Metric label="Trial subscriptions" value={metrics?.trial_subs} />
          <Metric label="Sales (UGX)" value={metrics?.sales_ugx?.toLocaleString()} />
          <Metric label="Open support" value={metrics?.open_support} />
          <Metric label="Pending annual" value={metrics?.pending_annual} />
          {showMore && <>
            <Metric label="Ended trials" value={metrics?.ended_trials} />
            <Metric label="Expiring soon" value={metrics?.expiring_soon} />
            <Metric label="Active devices" value={metrics?.active_devices} />
            <Metric label="Suspended shops" value={metrics?.suspended_shops} />
          </>}
        </div>
      </section>

      {/* Field map */}
      <section id="ops-map">
        <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-foreground/70">Field map</h2>
        <FieldMap pins={pins} />
      </section>

      {/* Plans */}
      <section id="ops-plans">
        <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-foreground/70">Plans</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["starter", "business", "waka_plus"].map((code) => (
            <PlanCard key={code} code={code} shops={shops} />
          ))}
        </div>
      </section>

      {/* Pending subscription requests */}
      <Section id="ops-pending-trials" title="Pending subscription requests" count={subReqs.length}>
        {subReqs.length === 0 ? <Empty>No pending requests</Empty> : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {subReqs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div><div className="font-bold">{r.requested_plan}</div><div className="text-xs text-muted-foreground">org {r.org_id ?? "—"} · {new Date(r.created_at).toLocaleString()}</div></div>
                {canManageSubs(me?.role) && (
                  <div className="flex gap-2">
                    <button onClick={async () => { await supabase.from("waka_subscription_requests" as any).update({ status: "approved" }).eq("id", r.id); setTick((t) => t + 1); }} className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Approve</button>
                    <button onClick={async () => { await supabase.from("waka_subscription_requests" as any).update({ status: "rejected" }).eq("id", r.id); setTick((t) => t + 1); }} className="rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">Reject</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Annual plan queue */}
      <Section id="ops-annual-queue" title="Annual plan & payments queue" count={annual.length}>
        {annual.length === 0 ? <Empty>No annual requests</Empty> : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {annual.map((t) => (
              <li key={t.id} className="space-y-2 p-3 text-sm">
                <div className="flex items-center justify-between"><div className="font-bold">{t.subject}</div><span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span></div>
                {t.body && <p className="text-xs text-muted-foreground">{t.body}</p>}
                {canResolveSupport(me?.role) && (
                  <div className="flex gap-2">
                    <button onClick={async () => { await supabase.from("waka_support_tickets" as any).update({ status: "in_progress" }).eq("id", t.id); setTick((t) => t + 1); }} className="rounded-full bg-orange-600 px-3 py-1 text-xs font-bold text-white">In progress</button>
                    <button onClick={async () => { await supabase.from("waka_support_tickets" as any).update({ status: "resolved" }).eq("id", t.id); setTick((t) => t + 1); }} className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Close</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Districts */}
      <Section id="ops-districts" title="Districts" count={districts.length}>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2 text-left">District</th><th className="px-3 py-2 text-right">Shops</th><th className="px-3 py-2 text-right">Active</th><th className="px-3 py-2 text-right">Paid</th></tr>
            </thead>
            <tbody>
              {districtRows.map((d) => (
                <tr key={d.id} className="border-t border-border"><td className="px-3 py-2">{d.name}</td><td className="px-3 py-2 text-right">{d.total}</td><td className="px-3 py-2 text-right">{d.active}</td><td className="px-3 py-2 text-right">{d.paid}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Recent shops */}
      <Section id="ops-recent-shops" title="Recent shops" count={shops.length}>
        {shops.length === 0 ? <Empty>No shops yet</Empty> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shops.map((s) => (
              <Link key={s.id} to="/internal/waka/shop/$shopId" params={{ shopId: s.id }} className="rounded-xl border border-border bg-card p-3 text-sm hover:border-orange-500">
                <div className="flex items-center justify-between"><div className="font-bold">{s.name}</div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{s.is_active ? "Active" : "Inactive"}</span></div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.city ?? "—"} · {s.owner_name ?? s.owner_email ?? "—"}</div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-bold">{s.plan_code}</span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${s.gps_lat ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{s.gps_lat ? "GPS ok" : "No GPS"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* Support queue */}
      <Section id="ops-support" title="Support queue" count={support.length}>
        {support.length === 0 ? <Empty>No tickets</Empty> : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {support.map((t) => (
              <li key={t.id} className="space-y-1 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold">{t.subject}</div>
                  <div className="flex gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.priority === "urgent" ? "bg-rose-100 text-rose-700" : t.priority === "high" ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"}`}>{t.priority}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">{t.status}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{t.channel} · {t.issue_type} · {new Date(t.created_at).toLocaleString()}</div>
                {canResolveSupport(me?.role) && (
                  <div className="flex gap-2 pt-1">
                    <button onClick={async () => { await supabase.from("waka_support_tickets" as any).update({ status: "in_progress" }).eq("id", t.id); setTick((t) => t + 1); }} className="rounded-full bg-orange-600 px-2.5 py-0.5 text-[10px] font-bold text-white">In progress</button>
                    <button onClick={async () => { await supabase.from("waka_support_tickets" as any).update({ status: "resolved" }).eq("id", t.id); setTick((t) => t + 1); }} className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white">Resolved</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Shortcut({ href, Icon, label, count }: { href: string; Icon: any; label: string; count: number }) {
  return (
    <a href={href} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:border-orange-500">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-100 text-orange-700"><Icon className="h-5 w-5" /></span>
      <div><div className="text-xs font-bold uppercase text-muted-foreground">{label}</div><div className="text-lg font-black">{count}</div></div>
    </a>
  );
}

function Metric({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] font-bold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black">{value ?? "—"}</div>
    </div>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section id={id}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-foreground/70">
        {title} {typeof count === "number" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function PlanCard({ code, shops }: { code: string; shops: any[] }) {
  const active = shops.filter((s) => s.plan_code === code && s.subscription_status === "active").length;
  const trial = shops.filter((s) => s.plan_code === code && (s.subscription_status === "trial" || s.subscription_status === "trialing")).length;
  const prices: Record<string, number> = { starter: 25000, business: 49000, waka_plus: 99000 };
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-bold uppercase text-muted-foreground">{code.replace("_", " ")}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        <div><div className="text-lg font-black">{active}</div><div className="text-[10px] text-muted-foreground">Active</div></div>
        <div><div className="text-lg font-black">{trial}</div><div className="text-[10px] text-muted-foreground">Trial</div></div>
        <div><div className="text-lg font-black">UGX {(active * (prices[code] ?? 0)).toLocaleString()}</div><div className="text-[10px] text-muted-foreground">MRR est</div></div>
      </div>
    </div>
  );
}
