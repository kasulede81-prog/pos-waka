import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WakaAdminShell } from "@/components/internal/waka-admin-shell";
import { useWakaInternalMe, canManageSubs, canShopSupportActions } from "@/lib/waka-admin";

export const Route = createFileRoute("/internal/waka/shop/$shopId")({ component: Page });

function Page() {
  return <WakaAdminShell activeTab=""><ShopOps /></WakaAdminShell>;
}

const PLAN_PRICES: Record<string, number> = { starter: 25000, business: 49000, waka_plus: 99000 };

function ShopOps() {
  const { shopId } = Route.useParams();
  const { me } = useWakaInternalMe();
  const [shop, setShop] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [planCode, setPlanCode] = useState("free");
  const [daysValid, setDaysValid] = useState(365);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void Promise.all([
      supabase.from("waka_shops" as any).select("*").eq("id", shopId).single(),
      supabase.from("waka_shop_devices" as any).select("*").eq("shop_id", shopId).order("last_seen_at", { ascending: false }),
      supabase.from("waka_subscription_payments" as any).select("*").eq("shop_id", shopId).order("paid_at", { ascending: false }).limit(20),
    ]).then(([s, d, p]) => { setShop(s.data); setDevices(d.data ?? []); setPayments(p.data ?? []); if (s.data) setPlanCode((s.data as any).plan_code); });
  }, [shopId, tick]);

  const applyPlan = async () => {
    const { error } = await supabase.rpc("admin_shop_set_subscription_plan", { _shop_id: shopId, _plan_code: planCode, _days_valid: daysValid });
    if (error) alert(error.message); else setTick((t) => t + 1);
  };

  const setShopActive = async (active: boolean) => {
    const { error } = await supabase.from("waka_shops" as any).update({ is_active: active }).eq("id", shopId);
    if (error) alert(error.message); else setTick((t) => t + 1);
  };

  const toggleDevice = async (id: string, patch: any) => {
    await supabase.from("waka_shop_devices" as any).update(patch).eq("id", id); setTick((t) => t + 1);
  };

  if (!shop) return <div className="p-6 text-sm text-muted-foreground">Loading shop…</div>;

  const online = (d: any) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 15 * 60_000;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/internal/waka" className="inline-flex items-center gap-1 text-orange-700 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to overview</Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">{shop.name}</h1>
            <div className="mt-1 text-sm text-muted-foreground">{shop.city ?? "—"} · {shop.owner_name ?? shop.owner_email ?? "—"} · {shop.phone ?? "—"}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5 font-bold">Plan: {shop.plan_code}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-bold">Sub: {shop.subscription_status}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-bold">Pay: {shop.payment_status}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-bold">Last seen: {shop.last_seen_at ? new Date(shop.last_seen_at).toLocaleString() : "—"}</span>
            </div>
          </div>
          {shop.gps_lat && shop.gps_lng && (
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${shop.gps_lat},${shop.gps_lng}`} target="_blank" rel="noreferrer" className="rounded-full bg-orange-600 px-3 py-1.5 text-xs font-bold text-white">Directions</a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-black uppercase">Sync health</h2>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
            <div><div className="text-lg font-black">{shop.pending_sync_count}</div><div className="text-[10px] text-muted-foreground">Pending</div></div>
            <div><div className="text-xs">{shop.last_sync_pull_at ? new Date(shop.last_sync_pull_at).toLocaleString() : "—"}</div><div className="text-[10px] text-muted-foreground">Last pull</div></div>
            <div><div className="text-xs">{shop.last_sync_push_at ? new Date(shop.last_sync_push_at).toLocaleString() : "—"}</div><div className="text-[10px] text-muted-foreground">Last push</div></div>
          </div>
          {shop.last_sync_error && <div className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{shop.last_sync_error}</div>}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-black uppercase">Plan control</h2>
          {canManageSubs(me?.role) ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex gap-2">
                <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5">
                  <option value="free">free</option><option value="starter">starter</option><option value="business">business</option><option value="waka_plus">waka_plus</option>
                </select>
                <input type="number" min={1} max={3650} value={daysValid} onChange={(e) => setDaysValid(Number(e.target.value))} disabled={planCode === "free"} className="w-24 rounded-lg border border-border bg-background px-2 py-1.5" />
                <button onClick={applyPlan} className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white">Apply</button>
              </div>
              <div className="text-[11px] text-muted-foreground">Suggested: Starter UGX {PLAN_PRICES.starter.toLocaleString()} · Business UGX {PLAN_PRICES.business.toLocaleString()} · Waka Plus UGX {PLAN_PRICES.waka_plus.toLocaleString()}</div>
            </div>
          ) : <p className="mt-2 text-xs text-muted-foreground">Operations role required.</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black uppercase">Devices ({devices.length})</h2>
        {devices.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No devices.</p> : (
          <ul className="mt-2 divide-y divide-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div className="font-bold">{d.label || d.fingerprint?.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{d.platform ?? "—"} · v{d.app_version ?? "—"} · {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "—"}</div>
                  <div className="mt-1 flex gap-1 text-[10px]">
                    {online(d) && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">Online</span>}
                    {d.trusted && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-700">Trusted</span>}
                    {d.suspicious && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-bold text-rose-700">Suspicious</span>}
                  </div>
                </div>
                {canShopSupportActions(me?.role) && (
                  <div className="flex gap-1">
                    <button onClick={() => toggleDevice(d.id, { is_active: !d.is_active })} className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold">{d.is_active ? "Deactivate" : "Activate"}</button>
                    <button onClick={() => toggleDevice(d.id, { trusted: !d.trusted })} className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold">{d.trusted ? "Untrust" : "Trust"}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black uppercase">Recent payments</h2>
        {payments.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No payments yet.</p> : (
          <ul className="mt-2 divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <div><div className="font-bold">UGX {Number(p.amount_ugx).toLocaleString()}</div><div className="text-xs text-muted-foreground">{p.plan_code ?? "—"} · {p.status}</div></div>
                <div className="text-xs text-muted-foreground">{new Date(p.paid_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canShopSupportActions(me?.role) && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-black uppercase">Shop actions</h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button onClick={() => setShopActive(!shop.is_active)} className={`rounded-full px-3 py-1.5 font-bold ${shop.is_active ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
              {shop.is_active ? "Suspend shop" : "Reactivate shop"}
            </button>
            <button onClick={async () => { await supabase.from("waka_shops" as any).update({ pending_sync_count: 0, last_sync_error: null }).eq("id", shopId); setTick((t) => t + 1); }} className="rounded-full bg-muted px-3 py-1.5 font-bold">Reset sync</button>
          </div>
        </section>
      )}
    </div>
  );
}
