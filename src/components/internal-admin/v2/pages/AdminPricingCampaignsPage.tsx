import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Percent, RefreshCw, Tag } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  CANONICAL_PLAN_PRICES,
  computePlanDisplayPrice,
  formatUgx,
  type MonthlyDiscountType,
  type PaidPlanCode,
} from "../../../../lib/subscriptionPricing";
import {
  fetchPricingCampaignAuditFeed,
  fetchPricingCampaignDiscounts,
  fetchPricingCampaignMetrics,
  fetchPricingCampaigns,
  isPricingCampaignActive,
  previewPricingCampaign,
  savePricingCampaign,
  savePricingCampaignPlanDiscount,
  type PricingCampaign,
  type PricingCampaignAuditEntry,
  type PricingCampaignMetrics,
  type PricingCampaignPlanDiscount,
} from "../../../../lib/pricingCampaignsAdmin";
import { adminPermissions } from "../adminRoles";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

type CampaignDraft = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
};

type PlanDraft = {
  monthlyDiscountType: MonthlyDiscountType;
  monthlyDiscountValue: string;
  annualDiscountPercent: string;
  reason: string;
};

const PAID_PLANS: PaidPlanCode[] = ["starter", "business", "waka_plus"];

const PLAN_LABELS: Record<PaidPlanCode, string> = {
  starter: "Starter",
  business: "Business",
  waka_plus: "Enterprise (Waka Plus)",
};

const EMPTY_CAMPAIGN: CampaignDraft = {
  id: null,
  name: "",
  description: "",
  enabled: false,
  startsAt: "",
  endsAt: "",
};

function emptyPlanDraft(): PlanDraft {
  return {
    monthlyDiscountType: "none",
    monthlyDiscountValue: "0",
    annualDiscountPercent: "20",
    reason: "",
  };
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-900 outline-none focus:border-orange-500";
const labelCls = "mb-1 block text-[11px] font-black uppercase tracking-wide text-stone-500";

export function AdminPricingCampaignsPage({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  const canEdit = perms.canManageBillingOffers;

  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<PricingCampaign[]>([]);
  const [, setDiscounts] = useState<PricingCampaignPlanDiscount[]>([]);
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_CAMPAIGN);
  const [planDrafts, setPlanDrafts] = useState<Record<PaidPlanCode, PlanDraft>>({
    starter: emptyPlanDraft(),
    business: emptyPlanDraft(),
    waka_plus: emptyPlanDraft(),
  });
  const [saving, setSaving] = useState(false);
  const [savingPlan, setSavingPlan] = useState<PaidPlanCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<PricingCampaignAuditEntry[]>([]);
  const [metrics, setMetrics] = useState<PricingCampaignMetrics | null>(null);
  const [previewPlans, setPreviewPlans] = useState<ReturnType<typeof computePlanDisplayPrice>[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [campaignRows, auditRows] = await Promise.all([
      fetchPricingCampaigns(),
      fetchPricingCampaignAuditFeed(40),
    ]);
    setCampaigns(campaignRows);
    setAudit(auditRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, previewMode]);

  const selectCampaign = useCallback(async (c: PricingCampaign) => {
    setDraft({
      id: c.id,
      name: c.name,
      description: c.description,
      enabled: c.enabled,
      startsAt: toDatetimeLocal(c.startsAt),
      endsAt: toDatetimeLocal(c.endsAt),
    });
    const rows = await fetchPricingCampaignDiscounts(c.id);
    setDiscounts(rows);
    const nextDrafts: Record<PaidPlanCode, PlanDraft> = {
      starter: emptyPlanDraft(),
      business: emptyPlanDraft(),
      waka_plus: emptyPlanDraft(),
    };
    for (const plan of PAID_PLANS) {
      const row = rows.find((r) => r.planCode === plan);
      nextDrafts[plan] = {
        monthlyDiscountType: row?.monthlyDiscountType ?? "none",
        monthlyDiscountValue: String(row?.monthlyDiscountValue ?? 0),
        annualDiscountPercent: String(row?.annualDiscountPercent ?? 20),
        reason: "",
      };
    }
    setPlanDrafts(nextDrafts);
    const preview = await previewPricingCampaign(c.id);
    setPreviewPlans(preview);
    const m = await fetchPricingCampaignMetrics({ campaignId: c.id });
    setMetrics(m);
  }, []);

  useEffect(() => {
    if (previewMode || campaigns.length === 0 || draft.id) return;
    void selectCampaign(campaigns[0]!);
  }, [campaigns, draft.id, previewMode, selectCampaign]);

  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => isPricingCampaignActive(c)),
    [campaigns],
  );

  const previewFromDrafts = useMemo(() => {
    return PAID_PLANS.map((plan) => {
      const pd = planDrafts[plan];
      return computePlanDisplayPrice(plan, {
        monthlyDiscountType: pd.monthlyDiscountType,
        monthlyDiscountValue: Number(pd.monthlyDiscountValue) || 0,
        annualDiscountPercent: pd.annualDiscountPercent.trim()
          ? Number(pd.annualDiscountPercent)
          : null,
      });
    });
  }, [planDrafts]);

  const saveCampaign = async () => {
    if (!canEdit) return;
    setSaving(true);
    setNotice(null);
    const res = await savePricingCampaign({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      enabled: draft.enabled,
      startsAt: fromDatetimeLocal(draft.startsAt),
      endsAt: fromDatetimeLocal(draft.endsAt),
    });
    setSaving(false);
    if (!res.ok) {
      setNotice(res.error ?? "Save failed");
      return;
    }
    setNotice("Campaign saved.");
    await load();
    if (res.campaignId) {
      const updated = (await fetchPricingCampaigns()).find((c) => c.id === res.campaignId);
      if (updated) void selectCampaign(updated);
    }
  };

  const savePlanDiscount = async (plan: PaidPlanCode) => {
    if (!canEdit || !draft.id) return;
    const pd = planDrafts[plan];
    if (!pd.reason.trim()) {
      setNotice("Reason is required for discount changes.");
      return;
    }
    setSavingPlan(plan);
    setNotice(null);
    const res = await savePricingCampaignPlanDiscount({
      campaignId: draft.id,
      planCode: plan,
      monthlyDiscountType: pd.monthlyDiscountType,
      monthlyDiscountValue: Number(pd.monthlyDiscountValue) || 0,
      annualDiscountPercent: pd.annualDiscountPercent.trim() ? Number(pd.annualDiscountPercent) : null,
      reason: pd.reason.trim(),
    });
    setSavingPlan(null);
    if (!res.ok) {
      setNotice(res.error ?? "Discount save failed");
      return;
    }
    setNotice(`${PLAN_LABELS[plan]} discount saved.`);
    setPlanDrafts((prev) => ({ ...prev, [plan]: { ...prev[plan], reason: "" } }));
    const c = campaigns.find((x) => x.id === draft.id);
    if (c) void selectCampaign(c);
    const auditRows = await fetchPricingCampaignAuditFeed(40);
    setAudit(auditRows);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-stone-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing campaigns…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/internal/waka/billing"
            className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-orange-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Billing
          </Link>
          <h1 className="text-xl font-black text-stone-900">Pricing Campaigns</h1>
          <p className="text-sm text-stone-500">
            Temporary discounts without changing canonical plan prices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-sm font-bold text-stone-700"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {!canEdit ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Read-only — billing permissions required to edit campaigns.
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {notice}
        </p>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">Active campaigns</h2>
        {activeCampaigns.length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-stone-500">No active campaigns — canonical prices shown on marketing pages.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {activeCampaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-orange-50 px-3 py-2">
                <span className="text-sm font-black text-orange-950">{c.name}</span>
                <span className="text-xs font-bold text-emerald-700">Live</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_CAMPAIGN);
              setDiscounts([]);
              setPreviewPlans(CANONICAL_PLAN_PRICES.map((p) =>
                computePlanDisplayPrice(p.planCode, { monthlyDiscountType: "none", monthlyDiscountValue: 0 }),
              ));
            }}
            className="flex w-full min-h-[40px] items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 text-sm font-black text-stone-600"
          >
            <Tag className="h-4 w-4" /> New campaign
          </button>
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void selectCampaign(c)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm font-bold ${
                draft.id === c.id
                  ? "border-orange-400 bg-orange-50 text-orange-950"
                  : "border-stone-200 bg-white text-stone-800"
              }`}
            >
              {c.name}
              {isPricingCampaignActive(c) ? (
                <span className="ml-2 text-[10px] font-black uppercase text-emerald-700">Active</span>
              ) : null}
            </button>
          ))}
        </aside>

        <div className="space-y-5">
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">Campaign settings</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  disabled={!canEdit}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Description</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className={labelCls}>Start</label>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={draft.startsAt}
                  onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className={labelCls}>End</label>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={draft.endsAt}
                  onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
                  disabled={!canEdit}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-bold text-stone-800">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                  disabled={!canEdit}
                />
                Enable campaign
              </label>
            </div>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void saveCampaign()}
                disabled={saving}
                className="mt-4 min-h-[44px] rounded-xl bg-orange-600 px-5 text-sm font-black text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : draft.id ? "Save campaign" : "Create campaign"}
              </button>
            ) : null}
          </section>

          {draft.id ? (
            <section className="space-y-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">Plan discounts</h2>
              {PAID_PLANS.map((plan) => {
                const pd = planDrafts[plan];
                const canonical = CANONICAL_PLAN_PRICES.find((p) => p.planCode === plan)!;
                const computed = previewFromDrafts.find((p) => p.planCode === plan)!;
                return (
                  <div key={plan} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="text-base font-black text-stone-900">{PLAN_LABELS[plan]}</h3>
                      <div className="text-right text-sm">
                        <p className="font-semibold text-stone-500">
                          Original: <span className="font-black text-stone-800">{formatUgx(canonical.monthlyPriceUgx)}</span>
                        </p>
                        <p className="font-semibold text-stone-500">
                          Discount:{" "}
                          <span className="font-black text-orange-700">{formatUgx(computed.monthlyDiscountUgx)}</span>
                        </p>
                        <p className="font-semibold text-stone-500">
                          Final: <span className="font-black text-emerald-700">{formatUgx(computed.finalMonthlyUgx)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className={labelCls}>Monthly discount type</label>
                        <select
                          className={inputCls}
                          value={pd.monthlyDiscountType}
                          onChange={(e) =>
                            setPlanDrafts((prev) => ({
                              ...prev,
                              [plan]: { ...prev[plan], monthlyDiscountType: e.target.value as MonthlyDiscountType },
                            }))
                          }
                          disabled={!canEdit}
                        >
                          <option value="none">None</option>
                          <option value="fixed_amount">Fixed amount (UGX off)</option>
                          <option value="percentage">Percentage off</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Discount value</label>
                        <input
                          className={inputCls}
                          type="number"
                          min={0}
                          value={pd.monthlyDiscountValue}
                          onChange={(e) =>
                            setPlanDrafts((prev) => ({
                              ...prev,
                              [plan]: { ...prev[plan], monthlyDiscountValue: e.target.value },
                            }))
                          }
                          disabled={!canEdit || pd.monthlyDiscountType === "none"}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>
                          <Percent className="mr-1 inline h-3 w-3" />
                          Annual discount %
                        </label>
                        <input
                          className={inputCls}
                          type="number"
                          min={0}
                          max={90}
                          value={pd.annualDiscountPercent}
                          onChange={(e) =>
                            setPlanDrafts((prev) => ({
                              ...prev,
                              [plan]: { ...prev[plan], annualDiscountPercent: e.target.value },
                            }))
                          }
                          disabled={!canEdit}
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className={labelCls}>Reason (required for audit)</label>
                        <input
                          className={inputCls}
                          value={pd.reason}
                          onChange={(e) =>
                            setPlanDrafts((prev) => ({
                              ...prev,
                              [plan]: { ...prev[plan], reason: e.target.value },
                            }))
                          }
                          disabled={!canEdit}
                          placeholder="e.g. Q2 launch promotion"
                        />
                      </div>
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => void savePlanDiscount(plan)}
                        disabled={savingPlan === plan}
                        className="mt-3 min-h-[40px] rounded-xl border border-orange-300 bg-white px-4 text-sm font-black text-orange-800 disabled:opacity-60"
                      >
                        {savingPlan === plan ? "Saving…" : `Save ${PLAN_LABELS[plan]} discount`}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-5">
            <h2 className="text-sm font-black uppercase tracking-wide text-orange-800">Marketing preview</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {(draft.id ? previewPlans : previewFromDrafts).map((p) => (
                <div key={p.planCode} className="rounded-xl bg-white p-4 shadow-sm">
                  <p className="text-xs font-black uppercase text-stone-500">{PLAN_LABELS[p.planCode]}</p>
                  {p.hasMonthlyDiscount ? (
                    <p className="mt-1 text-sm font-bold text-stone-400 line-through">{formatUgx(p.originalMonthlyUgx)}</p>
                  ) : null}
                  <p className="text-xl font-black text-orange-700">{formatUgx(p.finalMonthlyUgx)} / month</p>
                  {p.hasMonthlyDiscount ? (
                    <p className="text-xs font-black text-emerald-700">Save {formatUgx(p.monthlyDiscountUgx)}</p>
                  ) : null}
                  <p className="mt-2 text-sm font-bold text-stone-500 line-through">{formatUgx(p.originalAnnualFullUgx)}</p>
                  <p className="text-sm font-black text-stone-800">{formatUgx(p.finalAnnualUgx)} / year</p>
                  <p className="text-xs font-black text-emerald-700">Save {p.annualDiscountPercent}%</p>
                </div>
              ))}
            </div>
          </section>

          {metrics ? (
            <section className="rounded-2xl border border-stone-200 bg-white p-5">
              <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">Campaign reporting</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-stone-50 p-3">
                  <p className="text-xs font-bold text-stone-500">New subscribers</p>
                  <p className="text-2xl font-black text-stone-900">{metrics.newSubscribers}</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3">
                  <p className="text-xs font-bold text-stone-500">Revenue recorded</p>
                  <p className="text-2xl font-black text-stone-900">{formatUgx(metrics.revenueRecordedUgx)}</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3">
                  <p className="text-xs font-bold text-stone-500">Conversion rate</p>
                  <p className="text-2xl font-black text-stone-900">{metrics.conversionRatePercent}%</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3">
                  <p className="text-xs font-bold text-stone-500">By plan</p>
                  <p className="text-sm font-bold text-stone-700">
                    {Object.entries(metrics.newSubscribersByPlan)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ") || "—"}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">Audit history</h2>
            {audit.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-stone-500">No discount changes recorded yet.</p>
            ) : (
              <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {audit.map((row) => (
                  <li key={row.id} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2 text-sm">
                    <p className="font-black text-stone-900">
                      {row.actorName || "Admin"} · {row.planCode ?? "campaign"}
                    </p>
                    <p className="text-xs font-semibold text-stone-500">
                      {new Date(row.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 font-semibold text-stone-700">{row.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
