import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { WakaAdminShell } from "@/components/internal/waka-admin-shell";
import { useWakaInternalMe, roleLabel, type WakaRole } from "@/lib/waka-admin";

export const Route = createFileRoute("/internal/waka/admins")({ component: Page });

function Page() {
  return <WakaAdminShell activeTab="/internal/waka/admins"><Admins /></WakaAdminShell>;
}

const ROLES: WakaRole[] = ["super_admin", "operations_admin", "support_admin", "field_agent"];

function Admins() {
  const { me, isSuper } = useWakaInternalMe();
  const [admins, setAdmins] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");
  const [form, setForm] = useState({ email: "", full_name: "", role: "support_admin" as WakaRole, districts: [] as string[] });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void Promise.all([
      supabase.from("waka_internal_admins" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("waka_districts" as any).select("*").order("name"),
    ]).then(([a, d]) => { setAdmins(a.data ?? []); setDistricts(d.data ?? []); });
  }, [tick]);

  if (me && !isSuper) {
    return <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">Super admin only.</div>;
  }

  const create = async () => {
    if (!form.email) return;
    const { error } = await supabase.rpc("internal_admin_create_by_email", {
      _email: form.email, _role: form.role, _districts: form.districts, _full_name: form.full_name || "",
    });
    if (error) alert(error.message);
    else { setForm({ email: "", full_name: "", role: "support_admin", districts: [] }); setTick((t) => t + 1); }
  };

  const update = async (a: any, patch: { role?: WakaRole; districts?: string[]; full_name?: string; is_active?: boolean }) => {
    const { error } = await supabase.rpc("internal_admin_update_role_and_districts", {
      _user_id: a.user_id,
      _role: (patch.role ?? a.role) as WakaRole,
      _districts: patch.districts ?? a.assigned_districts ?? [],
      _full_name: patch.full_name ?? a.full_name ?? "",
      _is_active: patch.is_active ?? a.is_active,
    });
    if (error) alert(error.message);
    setTick((t) => t + 1);
  };

  const filtered = admins.filter((a) => {
    if (filterRole !== "all" && a.role !== filterRole) return false;
    if (activeFilter === "active" && !a.is_active) return false;
    if (activeFilter === "inactive" && a.is_active) return false;
    if (q && !(a.email?.toLowerCase().includes(q.toLowerCase()) || a.full_name?.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black uppercase">Add admin by email</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input placeholder="full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as WakaRole })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
          <button onClick={create} className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white">Add</button>
        </div>
        <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-muted-foreground">Assign districts ({form.districts.length})</summary>
          <div className="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-auto sm:grid-cols-4">
            {districts.map((d) => (
              <label key={d.id} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={form.districts.includes(d.id)} onChange={(e) => setForm({ ...form, districts: e.target.checked ? [...form.districts, d.id] : form.districts.filter((x) => x !== d.id) })} />
                {d.name}
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="flex flex-wrap gap-2">
        <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as any)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </select>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {filtered.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div>
              <div className="font-bold">{a.full_name || a.email}</div>
              <div className="text-xs text-muted-foreground">{a.email} · {roleLabel(a.role)} · {a.assigned_districts?.length ?? 0} districts</div>
            </div>
            <div className="flex gap-2">
              <select value={a.role} onChange={(e) => update(a, { role: e.target.value as WakaRole })} className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              <button onClick={() => update(a, { is_active: !a.is_active })} className={`rounded-full px-3 py-1 text-xs font-bold ${a.is_active ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                {a.is_active ? "Deactivate" : "Activate"}
              </button>
            </div>
          </li>
        ))}
        {filtered.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No admins match these filters.</li>}
      </ul>
    </div>
  );
}
