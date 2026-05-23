import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WakaAdminShell } from "@/components/internal/waka-admin-shell";
import { useWakaInternalMe, canManageSubs } from "@/lib/waka-admin";

export const Route = createFileRoute("/internal/waka/activations")({ component: Page });

function Page() {
  return <WakaAdminShell activeTab="/internal/waka/activations"><Activations /></WakaAdminShell>;
}

function Activations() {
  const { me } = useWakaInternalMe();
  const [rows, setRows] = useState<any[]>([]);
  const [planCode, setPlanCode] = useState("business");
  const [validDays, setValidDays] = useState(365);
  const [deviceLimit, setDeviceLimit] = useState(3);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void supabase.from("waka_business_activations" as any).select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, [tick]);

  const resolve = async (id: string, approve: boolean) => {
    const { error } = await supabase.rpc("ops_resolve_activation_request", {
      _id: id, _approve: approve, _plan_code: planCode, _valid_days: validDays, _device_limit: deviceLimit, _reason: approve ? "" : "Rejected by admin",
    });
    if (error) alert(error.message);
    setTick((t) => t + 1);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black uppercase">Approval settings</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted-foreground">Plan code</span>
            <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5">
              <option value="free">free</option><option value="starter">starter</option><option value="business">business</option><option value="waka_plus">waka_plus</option>
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted-foreground">Valid days</span>
            <input type="number" value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} className="rounded-lg border border-border bg-background px-2 py-1.5" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-bold text-muted-foreground">Device limit</span>
            <input type="number" value={deviceLimit} onChange={(e) => setDeviceLimit(Number(e.target.value))} className="rounded-lg border border-border bg-background px-2 py-1.5" /></label>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-4 py-2 text-sm font-black uppercase">Pending activations ({rows.filter((r) => r.status === "pending").length})</div>
        {rows.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">No activation requests</div> : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-bold">{r.business_name}</div>
                  <div className="text-xs text-muted-foreground">Ref {r.reference_code} · {r.owner_email ?? "—"} · {new Date(r.created_at).toLocaleString()}</div>
                  <div className="mt-1"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "pending" ? "bg-amber-100 text-amber-700" : r.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{r.status}</span></div>
                </div>
                {r.status === "pending" && canManageSubs(me?.role) && (
                  <div className="flex gap-2">
                    <button onClick={() => resolve(r.id, true)} className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"><Check className="h-3 w-3" /> Approve & issue</button>
                    <button onClick={() => resolve(r.id, false)} className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white"><X className="h-3 w-3" /> Reject</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
