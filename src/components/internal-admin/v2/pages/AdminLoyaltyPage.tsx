import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Loader2, Pencil, Plus, Power, Search, ShieldCheck, Store, Users, X } from "lucide-react";
import { AdminEmpty, AdminSection } from "../../adminUi";
import { canManageLoyalty, normalizeAdminRole } from "../adminRoles";
import { PlanActiveSheet, PlanEditorSheet, ShopEntitlementSheet } from "./AdminLoyaltyActions";
import {
  fetchLoyaltyAdminOverview,
  fetchLoyaltyAdminPlans,
  fetchLoyaltyAdminShopDetail,
  fetchLoyaltyAdminShopStates,
  fetchLoyaltyPlanImpact,
  type LoyaltyAdminOverview,
  type LoyaltyAdminPlan,
  type LoyaltyAdminShopDetail,
  type LoyaltyAdminShopFilter,
  type LoyaltyAdminShopState,
  type LoyaltyPlanImpact,
} from "../../../../lib/loyaltyAdmin";

/**
 * Internal Loyalty Control Plane (Phase 6B reads + Phase 6C actions).
 *
 * Every number on this page comes from a SECURITY DEFINER read RPC that re-checks the
 * internal-admin role in the database; nothing here reads or writes a protected Loyalty
 * table directly. The Phase 6C action controls open confirmation dialogs
 * (AdminLoyaltyActions.tsx) that call the Phase 6A mutation RPCs through
 * lib/loyaltyAdminActions.ts. Hiding the controls for other roles is cosmetic — the RPCs
 * refuse anyone outside super_admin / operations_admin. After every successful change the
 * page reloads its figures from the server.
 */

type Props = {
  adminRow: { role?: string | null } | null;
  previewMode?: boolean;
};

const FILTERS: Array<{ id: LoyaltyAdminShopFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "enabled", label: "Loyalty on" },
  { id: "disabled", label: "Loyalty off" },
  { id: "over_limit", label: "Over limit" },
];

function nf(value: number): string {
  return value.toLocaleString();
}

function ugx(value: number): string {
  return value > 0 ? `UGX ${value.toLocaleString()}` : "—";
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = "default",
  hint,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  tone?: "default" | "warn";
  hint?: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${tone === "warn" ? "border-rose-200 bg-rose-50/60" : "border-border bg-card"}`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-rose-700" : "text-muted-foreground"}`} aria-hidden />
        <p className={`text-[11px] font-black uppercase tracking-wide ${tone === "warn" ? "text-rose-800" : "text-muted-foreground"}`}>
          {label}
        </p>
      </div>
      <p className={`mt-2 text-2xl font-black ${tone === "warn" ? "text-rose-900" : "text-foreground"}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AdminLoyaltyPage({ adminRow, previewMode = false }: Props) {
  // Informational only. Authorization is decided by the RPCs, never by this role string.
  const actingRole = normalizeAdminRole(adminRow?.role) || "unknown";
  // Cosmetic only: decides whether action buttons render. The RPCs re-check the role.
  const canAct = canManageLoyalty(actingRole);
  const [overview, setOverview] = useState<LoyaltyAdminOverview | null>(null);
  const [plans, setPlans] = useState<LoyaltyAdminPlan[]>([]);
  const [shops, setShops] = useState<LoyaltyAdminShopState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LoyaltyAdminShopFilter>("all");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [impact, setImpact] = useState<LoyaltyPlanImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [detail, setDetail] = useState<LoyaltyAdminShopDetail | null>(null);
  const [detailShop, setDetailShop] = useState<LoyaltyAdminShopState | null>(null);

  // Phase 6C dialogs. `editingPlan` undefined = closed, null = create, plan = edit.
  const [editingPlan, setEditingPlan] = useState<LoyaltyAdminPlan | null | undefined>(undefined);
  const [togglingPlan, setTogglingPlan] = useState<LoyaltyAdminPlan | null>(null);
  const [entitlementIntent, setEntitlementIntent] = useState<"enable" | "disable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The server decides who may read this; the client only reflects the answer, which is
  // why no data is loaded in preview mode (the preview row is deliberately not an admin).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [o, p, s] = await Promise.all([
      fetchLoyaltyAdminOverview(),
      fetchLoyaltyAdminPlans(),
      fetchLoyaltyAdminShopStates("", "all"),
    ]);
    setLoading(false);
    if (!o.ok) {
      setError(o.error === "forbidden" ? "forbidden" : "unavailable");
      return;
    }
    setOverview(o.data);
    setPlans(p.ok ? p.data : []);
    setShops(s.ok ? s.data : []);
  }, []);

  useEffect(() => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    void load();
  }, [previewMode, load]);

  const refreshShops = useCallback(async (q: string, f: LoyaltyAdminShopFilter) => {
    const r = await fetchLoyaltyAdminShopStates(q, f);
    setShops(r.ok ? r.data : []);
  }, []);

  useEffect(() => {
    if (previewMode || !overview) return;
    const handle = window.setTimeout(() => void refreshShops(query, filter), 250);
    return () => window.clearTimeout(handle);
  }, [query, filter, overview, previewMode, refreshShops]);

  const openPlanImpact = useCallback(async (plan: LoyaltyAdminPlan) => {
    setSelectedPlan(plan.code);
    setImpact(null);
    setImpactLoading(true);
    // "If this tier's limit were what it is now" — a pure read; changing it is Phase 6C.
    const r = await fetchLoyaltyPlanImpact(plan.code, plan.memberLimit);
    setImpactLoading(false);
    setImpact(r.ok ? r.data : null);
  }, []);

  const openShopDetail = useCallback(async (shop: LoyaltyAdminShopState) => {
    setDetailShop(shop);
    const r = await fetchLoyaltyAdminShopDetail(shop.shopId);
    setDetail(r.ok ? r.data : null);
  }, []);

  /**
   * After a successful mutation: close the dialog, say what happened, and re-read every
   * figure from the server (overview, catalog, shop list, open impact and shop detail) so
   * the page shows the authoritative post-change state rather than a local guess.
   */
  const onActionDone = useCallback(
    async (message: string) => {
      setEditingPlan(undefined);
      setTogglingPlan(null);
      setEntitlementIntent(null);
      setNotice(message);
      await load();
      if (selectedPlan) {
        const plansNow = await fetchLoyaltyAdminPlans();
        const row = plansNow.ok ? plansNow.data.find((p) => p.code === selectedPlan) : undefined;
        if (row) {
          const r = await fetchLoyaltyPlanImpact(row.code, row.memberLimit);
          setImpact(r.ok ? r.data : null);
        }
      }
      if (detailShop) {
        const [d, rows] = await Promise.all([
          fetchLoyaltyAdminShopDetail(detailShop.shopId),
          fetchLoyaltyAdminShopStates(detailShop.shopName, "all", 100),
        ]);
        setDetail(d.ok ? d.data : null);
        const fresh = rows.ok ? rows.data.find((s) => s.shopId === detailShop.shopId) : undefined;
        if (fresh) setDetailShop(fresh);
      }
    },
    [load, selectedPlan, detailShop],
  );

  const nextSortOrder = useMemo(() => plans.reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1, [plans]);

  const selectedPlanRow = useMemo(
    () => plans.find((p) => p.code === selectedPlan) ?? null,
    [plans, selectedPlan],
  );

  if (previewMode) {
    // The preview row is deliberately not an internal admin, so nothing is fetched here.
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black text-foreground">Loyalty Control Plane</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform Loyalty plans and organization entitlements.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm font-bold text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading Loyalty state…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-card p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-rose-700" aria-hidden />
        <p className="mt-2 text-sm font-black text-rose-900">
          {error === "forbidden" ? "You do not have access to the Loyalty control plane." : "Loyalty data is unavailable right now."}
        </p>
      </div>
    );
  }

  if (!overview) return <AdminEmpty>No Loyalty data available.</AdminEmpty>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-foreground">Loyalty Control Plane</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform Loyalty plans and organization entitlements.{" "}
          {canAct
            ? "Every change requires a reason, shows its impact first, and is recorded in the internal audit log."
            : "Your role can view this page but cannot change Loyalty."}
        </p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Signed in as {actingRole} · access is re-checked on every query and every change
        </p>
      </div>

      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900"
        >
          <span className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-emerald-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="Organizations"
          value={nf(overview.organizationsEnabled)}
          hint="with Loyalty enabled"
        />
        <MetricCard icon={Store} label="Shops" value={nf(overview.shopsEnabled)} hint="covered by those organizations" />
        <MetricCard icon={Users} label="Active members" value={nf(overview.activeMembers)} />
        <MetricCard
          icon={AlertTriangle}
          label="Over limit"
          value={nf(overview.shopsOverLimit)}
          tone={overview.shopsOverLimit > 0 ? "warn" : "default"}
          hint={
            overview.shopsOverLimit > 0
              ? `${nf(overview.organizationsOverLimit)} org(s) · ${nf(overview.membersOverLimit)} member(s) over`
              : "no shop is over its allowance"
          }
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ShieldCheck}
          label="Plans"
          value={`${nf(overview.plansActive)} / ${nf(overview.plansInactive)}`}
          hint="active / inactive"
        />
        <MetricCard icon={Users} label="Pending requests" value={nf(overview.pendingRequests)} hint="public enrollment awaiting approval" />
        <MetricCard icon={Store} label="Default tier" value={overview.defaultTierCode ?? "—"} hint="fallback for organizations with no tier" />
      </section>

      <AdminSection title="Plan catalog">
        {canAct ? (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setEditingPlan(null)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-foreground px-3 text-xs font-black text-background"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New plan
            </button>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-black">Code</th>
                <th className="py-2 pr-3 font-black">Name</th>
                <th className="py-2 pr-3 font-black">Member limit</th>
                <th className="py-2 pr-3 font-black">Monthly</th>
                <th className="py-2 pr-3 font-black">Annual</th>
                <th className="py-2 pr-3 font-black">Orgs</th>
                <th className="py-2 pr-3 font-black">Shops</th>
                <th className="py-2 pr-3 font-black">State</th>
                {canAct ? <th className="py-2 pr-3 font-black">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr
                  key={p.code}
                  onClick={() => void openPlanImpact(p)}
                  className={`cursor-pointer border-b border-border/60 ${selectedPlan === p.code ? "bg-muted/60" : ""} ${p.isActive ? "" : "opacity-60"}`}
                >
                  <td className="py-2 pr-3 font-black text-foreground">
                    {p.code}
                    {p.isDefault ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                        default
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-foreground">{p.name}</td>
                  <td className="py-2 pr-3 font-bold tabular-nums text-foreground">{nf(p.memberLimit)}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{ugx(p.monthlyPriceUgx)}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{ugx(p.annualPriceUgx)}</td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">{nf(p.organizations)}</td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">{nf(p.shops)}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                        p.isActive ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                  {canAct ? (
                    <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingPlan(p)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-border bg-card px-2 text-[11px] font-black text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setTogglingPlan(p)}
                          className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg border px-2 text-[11px] font-black ${
                            p.isActive ? "border-rose-200 bg-card text-rose-800" : "border-emerald-200 bg-card text-emerald-800"
                          }`}
                        >
                          <Power className="h-3.5 w-3.5" aria-hidden />
                          {p.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {plans.length === 0 ? (
                <tr>
                  <td colSpan={canAct ? 9 : 8} className="py-4 text-sm font-semibold text-muted-foreground">
                    No plans configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs font-semibold text-muted-foreground">
          Counts include organizations with no explicit tier that resolve to the default tier.
        </p>
      </AdminSection>

      <AdminSection title={selectedPlanRow ? `Plan impact — ${selectedPlanRow.name}` : "Plan impact"}>
        {!selectedPlanRow ? (
          <AdminEmpty>Select a plan above to see which organizations and shops its allowance reaches.</AdminEmpty>
        ) : impactLoading ? (
          <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Measuring impact…
          </div>
        ) : !impact ? (
          <AdminEmpty>Impact is unavailable for this plan.</AdminEmpty>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Building2} label="Organizations" value={nf(impact.organizations)} />
              <MetricCard icon={Store} label="Shops" value={nf(impact.shops)} />
              <MetricCard
                icon={AlertTriangle}
                label="Shops over limit"
                value={nf(impact.shopsOverLimit)}
                tone={impact.shopsOverLimit > 0 ? "warn" : "default"}
              />
              <MetricCard
                icon={Users}
                label="Members over limit"
                value={nf(impact.membersOverLimit)}
                tone={impact.membersOverLimit > 0 ? "warn" : "default"}
              />
            </div>
            <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-bold text-muted-foreground">
              At the current limit of {nf(impact.proposedMemberLimit)}, the figures above are what this tier already
              reaches. Changing a plan limit never removes existing members or points — it only governs new
              memberships. Use Edit on the plan to preview the impact of a different limit before saving it.
            </p>
          </div>
        )}
      </AdminSection>

      <AdminSection title="Shop Loyalty states">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shop or organization…"
              className="min-h-[42px] w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm font-semibold"
            />
          </label>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`min-h-[38px] rounded-xl px-3 text-xs font-black ${
                filter === f.id ? "bg-foreground text-background" : "border border-border bg-card text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-black">Shop</th>
                <th className="py-2 pr-3 font-black">Organization</th>
                <th className="py-2 pr-3 font-black">Loyalty</th>
                <th className="py-2 pr-3 font-black">Tier</th>
                <th className="py-2 pr-3 font-black">Members</th>
                <th className="py-2 pr-3 font-black">Allowance</th>
                <th className="py-2 pr-3 font-black">Pending</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s) => (
                <tr
                  key={s.shopId}
                  onClick={() => void openShopDetail(s)}
                  className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                >
                  <td className="py-2 pr-3 font-bold text-foreground">
                    {s.shopName}
                    {s.shopNumber ? <span className="ml-2 text-[11px] text-muted-foreground">{s.shopNumber}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{s.organizationName}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                        s.loyaltyEnabled ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.loyaltyEnabled ? "enabled" : "disabled"}
                    </span>
                    {s.loyaltyEnabled ? null : (
                      <span className="ml-2 text-[11px] font-semibold text-muted-foreground">{s.entitlementStatus}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{s.tierName ?? s.tierCode ?? "—"}</td>
                  <td className="py-2 pr-3 font-bold tabular-nums text-foreground">{nf(s.activeMembers)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {s.loyaltyEnabled ? (
                      s.overLimit ? (
                        <span className="font-black text-rose-700">
                          {nf(s.activeMembers)} / {nf(s.memberLimit)} — over by {nf(s.activeMembers - s.memberLimit)}
                        </span>
                      ) : (
                        <span className="text-foreground">{nf(s.activeMembers)} / {nf(s.memberLimit)}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">{nf(s.pendingRequests)}</td>
                </tr>
              ))}
              {shops.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-sm font-semibold text-muted-foreground">
                    No shops match this search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </AdminSection>

      {detail ? (
        <AdminSection title={`Shop detail — ${detail.shopId.slice(0, 8)}`}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={ShieldCheck}
              label="Loyalty"
              value={detail.loyaltyEnabled ? "enabled" : "disabled"}
              hint={detail.entitlementStatus}
            />
            <MetricCard icon={Store} label="Tier" value={detail.tierName ?? detail.tierCode ?? "—"} />
            <MetricCard
              icon={Users}
              label="Members"
              value={detail.loyaltyEnabled ? `${nf(detail.activeMembers)} / ${nf(detail.memberLimit)}` : "—"}
              hint={detail.loyaltyEnabled ? `${nf(detail.remaining)} remaining` : undefined}
              tone={detail.overLimit ? "warn" : "default"}
            />
            <MetricCard
              icon={AlertTriangle}
              label="Over limit"
              value={detail.overLimit ? "yes" : "no"}
              tone={detail.overLimit ? "warn" : "default"}
              hint={`${detail.pendingRequests} pending request(s)`}
            />
          </div>
          <p className="mt-3 text-xs font-semibold text-muted-foreground">
            {detailShop ? `${detailShop.shopName} · ${detailShop.organizationName}` : `Organization ${detail.organizationId.slice(0, 8)}`}{" "}
            · usage {detail.usagePercent}% of the allowance.
          </p>
          {canAct && detailShop && detailShop.shopId === detail.shopId ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEntitlementIntent("enable")}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-foreground px-3 text-xs font-black text-background"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {detail.loyaltyEnabled ? "Change plan" : "Enable Loyalty"}
              </button>
              {detail.entitlementStatus !== "none" ? (
                <button
                  type="button"
                  onClick={() => setEntitlementIntent("disable")}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-rose-200 bg-card px-3 text-xs font-black text-rose-800"
                >
                  <Power className="h-4 w-4" aria-hidden />
                  Disable Loyalty
                </button>
              ) : null}
            </div>
          ) : null}
        </AdminSection>
      ) : null}

      {canAct ? (
        <>
          <PlanEditorSheet
            open={editingPlan !== undefined}
            plan={editingPlan ?? null}
            nextSortOrder={nextSortOrder}
            onClose={() => setEditingPlan(undefined)}
            onDone={(m) => void onActionDone(m)}
          />
          <PlanActiveSheet plan={togglingPlan} onClose={() => setTogglingPlan(null)} onDone={(m) => void onActionDone(m)} />
          {entitlementIntent && detailShop ? (
            <ShopEntitlementSheet
              shop={detailShop}
              detail={detail}
              plans={plans}
              intent={entitlementIntent}
              onClose={() => setEntitlementIntent(null)}
              onDone={(m) => void onActionDone(m)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
