import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Loader2, Plus, RefreshCw, X } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  CANONICAL_PLAN_PRICES,
  computePlanDisplayPrice,
  formatUgx,
  type ComputedPlanPrice,
  type MonthlyDiscountType,
  type PaidPlanCode,
} from "../../../../lib/subscriptionPricing";
import {
  PLAN_LABELS,
  PRICING_CAMPAIGN_STATUS_LABELS,
  datetimeLocalFromIso,
  describeCampaignSchedule,
  describePlanDiscounts,
  hasErrors,
  pricingCampaignStatus,
  resolveEffectiveCampaign,
  shadowedLiveCampaigns,
  validateCampaignDraft,
  validatePlanDiscountDraft,
  type CampaignDraft,
  type CampaignDraftErrors,
  type PlanDiscountDraft,
  type PlanDiscountDraftErrors,
  type PricingCampaign,
  type PricingCampaignMetrics,
  type PricingCampaignPlanDiscount,
  type PricingCampaignStatus,
} from "../../../../lib/pricingCampaigns";
import {
  fetchPricingCampaignAuditFeed,
  fetchPricingCampaignDiscounts,
  fetchPricingCampaignMetrics,
  fetchPricingCampaigns,
  savePricingCampaign,
  savePricingCampaignPlanDiscount,
  type PricingCampaignAuditEntry,
} from "../../../../lib/pricingCampaignsAdmin";
import { notifyInternalOpsChanged } from "../../../../lib/internalAdminActionRunner";
import { internalAdminPreviewHref } from "../../../../lib/internalAdminPreview";
import { statusTokens, type StatusKind } from "../../../../lib/statusTokens";
import { adminPermissions } from "../adminRoles";
import { WakaSwitch } from "../../../enterprise/WakaSwitch";
import { ModalSheet } from "../../../layout/ModalSheet";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

const PAID_PLANS: PaidPlanCode[] = ["starter", "business", "waka_plus"];

const EMPTY_CAMPAIGN: CampaignDraft = {
  id: null,
  name: "",
  description: "",
  enabled: false,
  startsAt: "",
  endsAt: "",
};

const EMPTY_PLAN_DRAFT: PlanDiscountDraft = {
  monthlyDiscountType: "none",
  monthlyDiscountValue: "0",
  annualDiscountPercent: "",
};

function emptyPlanDrafts(): Record<PaidPlanCode, PlanDiscountDraft> {
  return {
    starter: { ...EMPTY_PLAN_DRAFT },
    business: { ...EMPTY_PLAN_DRAFT },
    waka_plus: { ...EMPTY_PLAN_DRAFT },
  };
}

/** Status → semantic token family (no hand-rolled emerald/rose). */
const STATUS_TOKEN: Record<PricingCampaignStatus, StatusKind> = {
  live: "success",
  scheduled: "info",
  ended: "expired",
  draft: "draft",
};

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none focus:border-waka-500 disabled:opacity-60";
const labelCls = "mb-1 block text-[11px] font-black uppercase tracking-wide text-muted-foreground";
const primaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white hover:bg-waka-700 disabled:opacity-60";
const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-muted px-3 text-sm font-black text-muted-foreground disabled:opacity-60";
const dangerBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger-muted px-4 text-sm font-black text-danger disabled:opacity-60";

/**
 * Preview-mode fixtures, mirroring the sample campaign `useAdminGlobalSearchData`
 * already carries so this window can be reviewed without production access.
 */
const PREVIEW_CAMPAIGNS: PricingCampaign[] = [
  {
    id: "preview-live",
    name: "Preview Launch Offer",
    description: "Sample pricing campaign",
    enabled: true,
    startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: "preview-scheduled",
    name: "Preview December Push",
    description: "Starts next week",
    enabled: true,
    startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    endsAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: "preview-draft",
    name: "Preview Untitled Draft",
    description: "",
    enabled: false,
    startsAt: null,
    endsAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date(Date.now() - 10_800_000).toISOString(),
  },
];

const PREVIEW_DISCOUNTS: PricingCampaignPlanDiscount[] = [
  {
    id: "preview-d1",
    campaignId: "preview-live",
    planCode: "starter",
    monthlyDiscountType: "percentage",
    monthlyDiscountValue: 10,
    annualDiscountPercent: 20,
  },
  {
    id: "preview-d2",
    campaignId: "preview-live",
    planCode: "business",
    monthlyDiscountType: "fixed_amount",
    monthlyDiscountValue: 6_000,
    annualDiscountPercent: null,
  },
];

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

export function AdminPricingCampaignsPage({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  // Narrower than the server on purpose: `_pricing_require_admin` admits any
  // internal staff member, while this window keeps pricing edits to the roles
  // that already own billing offers. Preview mode is never editable.
  const canEdit = perms.canManageBillingOffers && !previewMode;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<PricingCampaign[]>([]);
  const [discounts, setDiscounts] = useState<PricingCampaignPlanDiscount[]>([]);
  const [audit, setAudit] = useState<PricingCampaignAuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [draft, setDraft] = useState<CampaignDraft>(EMPTY_CAMPAIGN);
  const [draftErrors, setDraftErrors] = useState<CampaignDraftErrors>({});
  // Untouched schedule fields are written back verbatim: `datetime-local` has
  // minute precision, so echoing its rounded value would silently truncate an
  // existing campaign's timestamps on every save.
  const [originalSchedule, setOriginalSchedule] = useState<{ startsAt: string | null; endsAt: string | null }>({
    startsAt: null,
    endsAt: null,
  });
  const [planDrafts, setPlanDrafts] = useState<Record<PaidPlanCode, PlanDiscountDraft>>(emptyPlanDrafts);
  const [planErrors, setPlanErrors] = useState<Partial<Record<PaidPlanCode, PlanDiscountDraftErrors>>>({});
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savingPlan, setSavingPlan] = useState<PaidPlanCode | null>(null);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [metrics, setMetrics] = useState<PricingCampaignMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  /**
   * `silent` refetches after a mutation without blanking the page to a spinner.
   *
   * Returns what it actually loaded, and `discountsOk`, so callers re-sync drafts
   * from fresh rows rather than a stale closure — and know when they must NOT
   * re-sync at all. A failed query keeps whatever is already on screen: erasing
   * the list (and the plan editor) because a refresh failed would be worse than
   * showing stale rows next to an error banner.
   */
  const load = useCallback(
    async (opts?: {
      silent?: boolean;
    }): Promise<{
      campaigns: PricingCampaign[];
      discounts: PricingCampaignPlanDiscount[];
      discountsOk: boolean;
    }> => {
      if (previewMode) {
        setCampaigns(PREVIEW_CAMPAIGNS);
        setDiscounts(PREVIEW_DISCOUNTS);
        setAudit([]);
        setLoadError(null);
        setAuditError(null);
        setLoading(false);
        return { campaigns: PREVIEW_CAMPAIGNS, discounts: PREVIEW_DISCOUNTS, discountsOk: true };
      }
      if (!opts?.silent) setLoading(true);
      const [campaignRes, auditRes] = await Promise.all([
        fetchPricingCampaigns(),
        fetchPricingCampaignAuditFeed(40),
      ]);
      if (!campaignRes.ok) {
        setLoadError(campaignRes.error);
        setLoading(false);
        return { campaigns: [], discounts: [], discountsOk: false };
      }
      setLoadError(null);
      setCampaigns(campaignRes.data);
      if (auditRes.ok) {
        setAudit(auditRes.data);
        setAuditError(null);
      } else {
        // Never let a failed read render as “No discount changes recorded yet.”
        setAuditError(auditRes.error);
      }

      // One query for every campaign's discounts — the table shows each campaign's
      // pricing rule, and a per-row fetch made that an N+1.
      const discountRes = await fetchPricingCampaignDiscounts(campaignRes.data.map((c) => c.id));
      if (discountRes.ok) setDiscounts(discountRes.data);
      else setLoadError(discountRes.error);
      setLoading(false);
      return {
        campaigns: campaignRes.data,
        discounts: discountRes.ok ? discountRes.data : [],
        discountsOk: discountRes.ok,
      };
    },
    [previewMode],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Recomputed every render rather than memoised on a `new Date()`: the list is
  // small, and a clock-dependent memo would need its own ticking.
  const now = new Date();
  const effective = resolveEffectiveCampaign(campaigns, now);
  const shadowed = shadowedLiveCampaigns(campaigns, now);

  const discountsFor = useCallback(
    (campaignId: string | null): PricingCampaignPlanDiscount[] =>
      campaignId ? discounts.filter((d) => d.campaignId === campaignId) : [],
    [discounts],
  );

  const syncDraftFrom = useCallback((campaign: PricingCampaign) => {
    setDraft({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      enabled: campaign.enabled,
      startsAt: datetimeLocalFromIso(campaign.startsAt),
      endsAt: datetimeLocalFromIso(campaign.endsAt),
    });
    setOriginalSchedule({ startsAt: campaign.startsAt, endsAt: campaign.endsAt });
    setDraftErrors({});
  }, []);

  /**
   * `rows` is passed explicitly after a save so this reads the freshly loaded
   * discounts rather than the render-time closure's copy.
   */
  const syncPlanDraftsFrom = useCallback(
    (campaignId: string, rows?: PricingCampaignPlanDiscount[]) => {
      const source = rows ?? discountsFor(campaignId);
      const next = emptyPlanDrafts();
      for (const plan of PAID_PLANS) {
        const row = source.find((r) => r.planCode === plan);
        next[plan] = {
          monthlyDiscountType: row?.monthlyDiscountType ?? "none",
          monthlyDiscountValue: String(row?.monthlyDiscountValue ?? 0),
          annualDiscountPercent:
            row?.annualDiscountPercent === null || row?.annualDiscountPercent === undefined
              ? ""
              : String(row.annualDiscountPercent),
        };
      }
      setPlanDrafts(next);
      setPlanErrors({});
    },
    [discountsFor],
  );

  const refreshMetrics = useCallback(
    async (campaignId: string) => {
      // Clear first: never let one campaign's reporting sit under another's name
      // while the fetch is in flight.
      setMetrics(null);
      setMetricsError(null);
      if (previewMode) return;
      const res = await fetchPricingCampaignMetrics({ campaignId });
      if (res.ok) {
        setMetrics(res.data);
        setMetricsError(null);
      } else {
        setMetrics(null);
        setMetricsError(res.error);
      }
    },
    [previewMode],
  );

  const openCreate = useCallback(() => {
    setFormMode("create");
    setDraft(EMPTY_CAMPAIGN);
    setOriginalSchedule({ startsAt: null, endsAt: null });
    setDraftErrors({});
    setPlanDrafts(emptyPlanDrafts());
    setPlanErrors({});
    setReason("");
    setReasonError(null);
    setMetrics(null);
    setMetricsError(null);
    setNotice(null);
    setError(null);
  }, []);

  const openEdit = useCallback(
    (campaign: PricingCampaign) => {
      setFormMode("edit");
      syncDraftFrom(campaign);
      syncPlanDraftsFrom(campaign.id);
      setReason("");
      setReasonError(null);
      setNotice(null);
      setError(null);
      void refreshMetrics(campaign.id);
    },
    [refreshMetrics, syncDraftFrom, syncPlanDraftsFrom],
  );

  const closeForm = useCallback(() => {
    setFormMode("closed");
    setDraft(EMPTY_CAMPAIGN);
    setDraftErrors({});
    setPlanErrors({});
    setReason("");
    setReasonError(null);
    setMetrics(null);
    setMetricsError(null);
  }, []);

  const runAction = useCallback(
    async (
      fn: () => Promise<{ ok: boolean; error?: string }>,
      successMessage: string,
    ): Promise<{ ok: boolean; campaigns: PricingCampaign[]; discounts: PricingCampaignPlanDiscount[] }> => {
      setNotice(null);
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong. Please try again.");
        return { ok: false, campaigns: [], discounts: [] };
      }
      const fresh = await load({ silent: true });
      notifyInternalOpsChanged();
      setNotice(successMessage);
      return { ok: true, ...fresh };
    },
    [load],
  );

  const hasSavedDiscount = useCallback(
    (campaignId: string, plan: PaidPlanCode): boolean =>
      discounts.some(
        (d) => d.campaignId === campaignId && d.planCode === plan && d.monthlyDiscountType !== "none" && d.monthlyDiscountValue > 0,
      ),
    [discounts],
  );

  const submitCampaign = async () => {
    if (!canEdit || saving) return;
    const errors = validateCampaignDraft(draft);
    setDraftErrors(errors);
    if (hasErrors(errors)) {
      setError("Fix the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    const created = draft.id === null;
    const res = await savePricingCampaign({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      enabled: draft.enabled,
      // Only re-send a schedule the operator actually changed.
      startsAt:
        draft.startsAt === datetimeLocalFromIso(originalSchedule.startsAt)
          ? originalSchedule.startsAt
          : isoOrNull(draft.startsAt),
      endsAt:
        draft.endsAt === datetimeLocalFromIso(originalSchedule.endsAt)
          ? originalSchedule.endsAt
          : isoOrNull(draft.endsAt),
    });
    if (!res.ok) {
      setSaving(false);
      setError(res.error ?? "Could not save the campaign.");
      return;
    }
    const savedId = res.campaignId ?? draft.id;
    const fresh = await load({ silent: true });
    notifyInternalOpsChanged();
    if (savedId) {
      const updated = fresh.campaigns.find((c) => c.id === savedId);
      if (updated) {
        syncDraftFrom(updated);
        // Only re-seed the plan editor from rows that really loaded — an empty
        // `fresh.discounts` from a failed query would silently reset every plan
        // to "no discount".
        if (fresh.discountsOk) syncPlanDraftsFrom(updated.id, fresh.discounts);
        setFormMode("edit");
        void refreshMetrics(updated.id);
      }
    }
    setSaving(false);
    setNotice(created ? "Campaign created. Add plan discounts below." : "Campaign saved.");
  };

  const submitPlanDiscount = async (plan: PaidPlanCode) => {
    if (!canEdit || !draft.id || savingPlan) return;
    const planDraft = planDrafts[plan];
    const errors = validatePlanDiscountDraft(plan, planDraft, reason);
    setPlanErrors((prev) => ({ ...prev, [plan]: errors }));
    setReasonError(errors.reason ?? null);
    if (hasErrors(errors)) {
      setError("Fix the highlighted fields before saving.");
      return;
    }
    const removing = planDraft.monthlyDiscountType === "none" && hasSavedDiscount(draft.id, plan);

    const apply = async () => {
      setSavingPlan(plan);
      const res = await savePricingCampaignPlanDiscount({
        campaignId: draft.id as string,
        planCode: plan,
        monthlyDiscountType: planDraft.monthlyDiscountType,
        monthlyDiscountValue:
          planDraft.monthlyDiscountType === "none" ? 0 : Number(planDraft.monthlyDiscountValue),
        annualDiscountPercent: planDraft.annualDiscountPercent.trim()
          ? Number(planDraft.annualDiscountPercent)
          : null,
        reason: reason.trim(),
      });
      setSavingPlan(null);
      if (!res.ok) {
        setError(res.error ?? "Could not save the discount.");
        return;
      }
      setReason("");
      setReasonError(null);
      const fresh = await load({ silent: true });
      notifyInternalOpsChanged();
      if (fresh.discountsOk) syncPlanDraftsFrom(draft.id as string, fresh.discounts);
      void refreshMetrics(draft.id as string);
      setNotice(`${PLAN_LABELS[plan]} discount saved.`);
    };

    if (removing) {
      setConfirmRequest({
        title: `Remove the ${PLAN_LABELS[plan]} discount?`,
        body: `${PLAN_LABELS[plan]} goes back to its canonical price of ${formatUgx(
          canonicalMonthly(plan),
        )} per month. The change is recorded in the audit history.`,
        confirmLabel: "Remove discount",
        run: apply,
      });
      return;
    }
    await apply();
  };

  /** One-click activate / pause from the list, without opening the form. */
  const toggleCampaignEnabled = async (campaign: PricingCampaign, enabled: boolean) => {
    if (!canEdit || quickBusyId) return;
    const apply = async () => {
      setQuickBusyId(campaign.id);
      const result = await runAction(
        () =>
          savePricingCampaign({
            id: campaign.id,
            name: campaign.name,
            description: campaign.description,
            enabled,
            startsAt: campaign.startsAt,
            endsAt: campaign.endsAt,
          }),
        enabled ? `“${campaign.name}” activated.` : `“${campaign.name}” paused.`,
      );
      // Keep an open editor in step with a status changed from the list.
      if (result.ok && draft.id === campaign.id && formMode === "edit") {
        const updated = result.campaigns.find((c) => c.id === campaign.id);
        if (updated) syncDraftFrom(updated);
      }
      setQuickBusyId(null);
    };

    const isLiveNow = pricingCampaignStatus(campaign, now) === "live";
    if (!enabled && isLiveNow) {
      setConfirmRequest({
        title: `Pause “${campaign.name}”?`,
        body: "This campaign is live. Pausing it returns every plan to its canonical price on the marketing and upgrade pages immediately.",
        confirmLabel: "Pause campaign",
        run: apply,
      });
      return;
    }
    await apply();
  };

  // -------------------------------------------------------------------------
  // Derived preview
  // -------------------------------------------------------------------------

  const editingId = formMode === "edit" ? draft.id : null;
  const editorOpen = formMode !== "closed";
  const effectiveDiscounts = editorOpen ? [] : discountsFor(effective?.id ?? null);

  /**
   * One preview, two possible sources: the fields being edited, or — when no
   * editor is open — whatever the effective campaign is serving right now. The
   * previous screen showed both at once and they disagreed.
   */
  const previewPlans: ComputedPlanPrice[] = PAID_PLANS.map((plan) => {
    if (editorOpen) {
      const pd = planDrafts[plan];
      return computePlanDisplayPrice(plan, {
        monthlyDiscountType: pd.monthlyDiscountType,
        monthlyDiscountValue: pd.monthlyDiscountType === "none" ? 0 : Number(pd.monthlyDiscountValue) || 0,
        annualDiscountPercent: pd.annualDiscountPercent.trim() ? Number(pd.annualDiscountPercent) : null,
      });
    }
    const row = effectiveDiscounts.find((d) => d.planCode === plan);
    return computePlanDisplayPrice(plan, {
      monthlyDiscountType: row?.monthlyDiscountType ?? "none",
      monthlyDiscountValue: row?.monthlyDiscountValue ?? 0,
      annualDiscountPercent: row?.annualDiscountPercent ?? null,
    });
  });

  const previewCaption =
    formMode !== "closed"
      ? "Draft values — customers see this once you save and the campaign is live."
      : effective
        ? `Live for customers now — “${effective.name}”.`
        : "No campaign is live — marketing pages show the canonical list prices.";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="pricing-campaigns-loading">
        <Loader2 className="h-6 w-6 animate-spin text-waka-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pricing-campaigns-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={previewMode ? internalAdminPreviewHref("/internal/waka/billing") : "/internal/waka/billing"}
            className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-waka-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Billing
          </Link>
          <h1 className="text-xl font-black text-foreground">Pricing Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Temporary discounts on top of the canonical plan prices. Canonical prices are never changed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh campaigns"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-muted text-muted-foreground"
            data-testid="pricing-campaigns-refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={openCreate}
              className={primaryBtnCls}
              data-testid="pricing-campaign-new"
            >
              <Plus className="h-4 w-4" /> Create campaign
            </button>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <p className={statusTokens.warning.banner} data-testid="pricing-campaigns-readonly">
          {previewMode
            ? "Preview mode — campaign changes are disabled."
            : "Read-only — your admin role cannot change pricing campaigns."}
        </p>
      ) : null}

      {loadError ? (
        <div className={`${statusTokens.danger.banner} flex flex-wrap items-center gap-3`} role="alert" data-testid="pricing-campaigns-load-error">
          <span className="min-w-0 flex-1">{loadError}</span>
          <button type="button" onClick={() => void load()} className={secondaryBtnCls}>
            Try again
          </button>
        </div>
      ) : null}

      {error ? (
        <p className={statusTokens.danger.banner} role="alert" data-testid="pricing-campaigns-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={statusTokens.success.banner} role="status" data-testid="pricing-campaigns-notice">
          {notice}
        </p>
      ) : null}

      {shadowed.length > 0 ? (
        <p className={statusTokens.warning.banner} role="alert" data-testid="pricing-campaigns-overlap">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          {shadowed.length === 1 ? "Another campaign is also live" : `${shadowed.length} other campaigns are also live`} but
          only one can apply: {shadowed.map((c) => `“${c.name}”`).join(", ")} {shadowed.length === 1 ? "is" : "are"} not in
          use. Pause {shadowed.length === 1 ? "it" : "them"} or disable the winning campaign.
        </p>
      ) : null}

      {/* Campaigns -------------------------------------------------------- */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black text-foreground">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p
            className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm font-semibold text-muted-foreground"
            data-testid="pricing-campaigns-empty"
          >
            No campaigns yet. {canEdit ? "Create one to discount a plan without touching its canonical price." : ""}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5">Campaign</th>
                  <th className="px-2 py-1.5">Discount</th>
                  <th className="px-2 py-1.5">Schedule</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => {
                  const status = pricingCampaignStatus(campaign, now);
                  const rule = describePlanDiscounts(discountsFor(campaign.id));
                  const isWinner = effective?.id === campaign.id;
                  return (
                    <tr
                      key={campaign.id}
                      className="border-t border-border font-semibold text-foreground"
                      data-testid={`pricing-campaign-row-${campaign.id}`}
                    >
                      <td className="px-2 py-2 align-top">
                        <span className="font-black">{campaign.name}</span>
                        {campaign.description ? (
                          <span className="mt-0.5 block max-w-[28ch] text-xs font-medium text-muted-foreground">
                            {campaign.description}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top text-xs">
                        {rule || <span className="text-muted-foreground">No discounts</span>}
                      </td>
                      <td className="px-2 py-2 align-top text-xs text-muted-foreground">
                        {describeCampaignSchedule(campaign, (iso) =>
                          new Date(iso).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span className={statusTokens[STATUS_TOKEN[status]].badge} data-testid={`pricing-campaign-status-${campaign.id}`}>
                          {PRICING_CAMPAIGN_STATUS_LABELS[status]}
                        </span>
                        {isWinner && shadowed.length > 0 ? (
                          <span className="mt-1 block text-[10px] font-black uppercase text-warning">In use</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {canEdit ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void toggleCampaignEnabled(campaign, !campaign.enabled)}
                                disabled={quickBusyId === campaign.id}
                                className={secondaryBtnCls}
                                data-testid={`pricing-campaign-toggle-${campaign.id}`}
                              >
                                {quickBusyId === campaign.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : campaign.enabled ? (
                                  "Pause"
                                ) : (
                                  "Activate"
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEdit(campaign)}
                                className={secondaryBtnCls}
                                data-testid={`pricing-campaign-edit-${campaign.id}`}
                              >
                                Edit
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / edit ---------------------------------------------------- */}
      {formMode !== "closed" ? (
        <section className="rounded-2xl border border-border bg-card p-4" data-testid="pricing-campaign-form">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-black text-foreground">
              {formMode === "create" ? "New campaign" : `Edit “${draft.name || "campaign"}”`}
            </h2>
            <button type="button" onClick={closeForm} className={secondaryBtnCls} aria-label="Close form">
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-waka-700">Details</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls} htmlFor="campaign-name">
                    Campaign name
                  </label>
                  <input
                    id="campaign-name"
                    className={inputCls}
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    disabled={!canEdit}
                    aria-invalid={draftErrors.name ? true : undefined}
                    data-testid="pricing-campaign-name"
                  />
                  {draftErrors.name ? (
                    <p className="mt-1 text-xs font-bold text-danger" role="alert">
                      {draftErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls} htmlFor="campaign-description">
                    Description <span className="font-bold normal-case">(optional)</span>
                  </label>
                  <textarea
                    id="campaign-description"
                    className={inputCls}
                    rows={2}
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-waka-700">Schedule &amp; status</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="campaign-start">
                    Starts (optional)
                  </label>
                  <input
                    id="campaign-start"
                    type="datetime-local"
                    className={inputCls}
                    value={draft.startsAt}
                    onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
                    disabled={!canEdit}
                    aria-invalid={draftErrors.startsAt ? true : undefined}
                  />
                  {draftErrors.startsAt ? (
                    <p className="mt-1 text-xs font-bold text-danger" role="alert">
                      {draftErrors.startsAt}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className={labelCls} htmlFor="campaign-end">
                    Ends (optional)
                  </label>
                  <input
                    id="campaign-end"
                    type="datetime-local"
                    className={inputCls}
                    value={draft.endsAt}
                    onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
                    disabled={!canEdit}
                    aria-invalid={draftErrors.endsAt ? true : undefined}
                  />
                  {draftErrors.endsAt ? (
                    <p className="mt-1 text-xs font-bold text-danger" role="alert">
                      {draftErrors.endsAt}
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <WakaSwitch
                    checked={draft.enabled}
                    disabled={!canEdit}
                    onCheckedChange={(checked) => setDraft((d) => ({ ...d, enabled: checked }))}
                    label="Campaign enabled"
                    description="Only an enabled campaign inside its schedule reaches customers."
                    className="text-sm font-black text-foreground"
                  />
                </div>
              </div>
            </div>
          </div>

          {canEdit ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitCampaign()}
                disabled={saving}
                className={primaryBtnCls}
                data-testid="pricing-campaign-save"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? "Saving…" : formMode === "create" ? "Create campaign" : "Save campaign"}
              </button>
            </div>
          ) : null}

          {/* Plan discounts — only once the campaign exists (discounts FK it). */}
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-black text-foreground">Plan discounts</h3>
            {editingId ? (
              <>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  Each plan saves on its own and is recorded in the audit history with the reason below.
                </p>
                <div className="mt-3">
                  <label className={labelCls} htmlFor="campaign-reason">
                    Reason for this change
                  </label>
                  <input
                    id="campaign-reason"
                    className={inputCls}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      if (reasonError) setReasonError(null);
                    }}
                    disabled={!canEdit}
                    placeholder="e.g. Q2 launch promotion"
                    aria-invalid={reasonError ? true : undefined}
                    data-testid="pricing-campaign-reason"
                  />
                  {reasonError ? (
                    <p className="mt-1 text-xs font-bold text-danger" role="alert">
                      {reasonError}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-1.5">Plan</th>
                        <th className="px-2 py-1.5">Discount</th>
                        <th className="px-2 py-1.5">Amount</th>
                        <th className="px-2 py-1.5">Annual %</th>
                        <th className="px-2 py-1.5">Price after</th>
                        <th className="px-2 py-1.5 text-right">Save</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PAID_PLANS.map((plan) => {
                        const pd = planDrafts[plan];
                        const rowErrors = planErrors[plan] ?? {};
                        const computed = previewPlans.find((p) => p.planCode === plan);
                        return (
                          <tr key={plan} className="border-t border-border" data-testid={`pricing-plan-row-${plan}`}>
                            <td className="px-2 py-2 align-top text-sm font-black text-foreground">
                              {PLAN_LABELS[plan]}
                              <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
                                {formatUgx(canonicalMonthly(plan))} / month
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <select
                                aria-label={`${PLAN_LABELS[plan]} discount type`}
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
                                <option value="fixed_amount">Fixed amount off</option>
                                <option value="percentage">Percent off</option>
                              </select>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <input
                                aria-label={`${PLAN_LABELS[plan]} discount value`}
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
                                aria-invalid={rowErrors.monthlyDiscountValue ? true : undefined}
                              />
                              {rowErrors.monthlyDiscountValue ? (
                                <p className="mt-1 max-w-[22ch] text-xs font-bold text-danger" role="alert">
                                  {rowErrors.monthlyDiscountValue}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <input
                                aria-label={`${PLAN_LABELS[plan]} annual discount percent`}
                                className={inputCls}
                                type="number"
                                min={0}
                                max={90}
                                value={pd.annualDiscountPercent}
                                placeholder="20"
                                onChange={(e) =>
                                  setPlanDrafts((prev) => ({
                                    ...prev,
                                    [plan]: { ...prev[plan], annualDiscountPercent: e.target.value },
                                  }))
                                }
                                disabled={!canEdit}
                                aria-invalid={rowErrors.annualDiscountPercent ? true : undefined}
                              />
                              {rowErrors.annualDiscountPercent ? (
                                <p className="mt-1 max-w-[22ch] text-xs font-bold text-danger" role="alert">
                                  {rowErrors.annualDiscountPercent}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <span className="text-sm font-black text-foreground">
                                {formatUgx(computed?.finalMonthlyUgx ?? canonicalMonthly(plan))}
                              </span>
                              <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
                                {computed?.hasMonthlyDiscount
                                  ? `saves ${formatUgx(computed.monthlyDiscountUgx)} / month`
                                  : "no monthly discount"}
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top text-right">
                              {canEdit ? (
                                <button
                                  type="button"
                                  onClick={() => void submitPlanDiscount(plan)}
                                  disabled={savingPlan === plan}
                                  className={secondaryBtnCls}
                                  data-testid={`pricing-plan-save-${plan}`}
                                >
                                  {savingPlan === plan ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs font-semibold text-muted-foreground">
                  Leave Annual % blank to use the plan's standard annual discount (20%).
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                Save the campaign first, then add plan discounts.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* Pricing preview --------------------------------------------------- */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black text-foreground">Pricing preview</h2>
        <p className="mt-1 text-xs font-semibold text-muted-foreground" data-testid="pricing-preview-caption">
          {previewCaption}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {previewPlans.map((p) => (
            <div key={p.planCode} className="rounded-xl bg-muted p-3">
              <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                {PLAN_LABELS[p.planCode]}
              </p>
              {p.hasMonthlyDiscount ? (
                <p className="mt-1 text-xs font-bold text-muted-foreground line-through">
                  {formatUgx(p.originalMonthlyUgx)}
                </p>
              ) : null}
              <p className="text-lg font-black text-foreground">{formatUgx(p.finalMonthlyUgx)} / month</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {formatUgx(p.finalAnnualUgx)} / year · {p.annualDiscountPercent}% annual saving
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Reporting --------------------------------------------------------- */}
      {editingId ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-black text-foreground">Campaign reporting</h2>
          {metricsError ? (
            <p className="mt-2 text-sm font-semibold text-danger" role="alert">
              {metricsError}
            </p>
          ) : metrics ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile label="New subscribers" value={String(metrics.newSubscribers)} />
                <MetricTile label="Revenue recorded" value={formatUgx(metrics.revenueRecordedUgx)} />
                <MetricTile label="Conversion" value={`${metrics.conversionRatePercent}%`} />
                <MetricTile label="Subscriptions in window" value={String(metrics.totalSubscriptionsInWindow)} />
              </div>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">
                {Object.entries(metrics.newSubscribersByPlan)
                  .map(([plan, count]) => `${PLAN_LABELS[plan as PaidPlanCode] ?? plan}: ${count}`)
                  .join(" · ") || "No new subscribers in this campaign's window yet."}
              </p>
            </>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading reporting…
            </p>
          )}
        </section>
      ) : null}

      {/* Audit ------------------------------------------------------------- */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black text-foreground">Audit history</h2>
        {auditError ? (
          <p className="mt-1 text-sm font-semibold text-danger" role="alert" data-testid="pricing-campaigns-audit-error">
            {auditError}
          </p>
        ) : audit.length === 0 ? (
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            {previewMode ? "Audit history is hidden in preview mode." : "No discount changes recorded yet."}
          </p>
        ) : (
          <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
            {audit.map((row) => (
              <li key={row.id} className="rounded-xl bg-muted px-3 py-2 text-sm">
                <p className="font-black text-foreground">
                  {row.actorName || "Admin"} · {row.planCode ? PLAN_LABELS[row.planCode] : "campaign"}
                </p>
                <p className="text-xs font-semibold text-muted-foreground">
                  {row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}
                </p>
                <p className="mt-0.5 font-semibold text-muted-foreground">{row.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModalSheet
        open={confirmRequest !== null}
        onClose={() => (confirmBusy ? undefined : setConfirmRequest(null))}
        align="center"
        title={confirmRequest?.title ?? ""}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmRequest(null)}
              disabled={confirmBusy}
              className={secondaryBtnCls}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirmBusy}
              onClick={async () => {
                const req = confirmRequest;
                if (!req) return;
                setConfirmBusy(true);
                await req.run();
                setConfirmBusy(false);
                setConfirmRequest(null);
              }}
              className={dangerBtnCls}
              data-testid="pricing-campaign-confirm"
            >
              {confirmBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirmRequest?.confirmLabel ?? "Confirm"}
            </button>
          </div>
        }
      >
        <p className="text-sm font-semibold text-foreground">{confirmRequest?.body}</p>
      </ModalSheet>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-black text-foreground">{value}</p>
    </div>
  );
}

function canonicalMonthly(plan: PaidPlanCode): number {
  return CANONICAL_PLAN_PRICES.find((p) => p.planCode === plan)?.monthlyPriceUgx ?? 0;
}

function isoOrNull(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
