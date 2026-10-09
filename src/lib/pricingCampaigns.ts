/**
 * Pricing campaign domain logic — types, status derivation and validation.
 *
 * Pure module (no supabase import) so it can be unit-tested under the node test
 * project; `pricingCampaignsAdmin.ts` holds the RPC/table access and re-exports
 * these types, mirroring the `growthCampaigns` / `growthCampaignsAdmin` split.
 *
 * Everything here mirrors what migration `113_pricing_campaigns.sql` actually
 * does — the database stays the authority.
 */
import {
  CANONICAL_PLAN_PRICES,
  MAX_PERCENTAGE_DISCOUNT,
  MIN_FINAL_MONTHLY_UGX,
  formatUgx,
  type MonthlyDiscountType,
  type PaidPlanCode,
} from "./subscriptionPricing";

export type PricingCampaign = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PricingCampaignPlanDiscount = {
  id: string;
  campaignId: string;
  planCode: PaidPlanCode;
  monthlyDiscountType: MonthlyDiscountType;
  monthlyDiscountValue: number;
  annualDiscountPercent: number | null;
};

export type PricingCampaignAuditEntry = {
  id: string;
  campaignId: string | null;
  planCode: PaidPlanCode | null;
  actorName: string;
  previousDiscount: Record<string, unknown>;
  newDiscount: Record<string, unknown>;
  reason: string;
  createdAt: string;
};

export type PricingCampaignMetrics = {
  campaignId: string | null;
  campaignName: string | null;
  campaignActive: boolean;
  newSubscribers: number;
  newSubscribersByPlan: Record<string, number>;
  revenueRecordedUgx: number;
  conversionRatePercent: number;
  totalSubscriptionsInWindow: number;
};

export type PricingCampaignStatus = "draft" | "scheduled" | "live" | "ended";

export const PRICING_CAMPAIGN_STATUS_LABELS: Record<PricingCampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  ended: "Ended",
};

/**
 * Mirrors `public.pricing_campaign_is_active(c)`:
 *   enabled and (starts_at is null or now() >= starts_at) and (ends_at is null or now() < ends_at)
 *
 * `ended` is checked before `scheduled` so a row whose end precedes its start
 * (bad data the server never rejected) reads as “Ended” — the truth — instead of
 * “Scheduled”, which would imply it is still going to run.
 */
export function pricingCampaignStatus(
  campaign: Pick<PricingCampaign, "enabled" | "startsAt" | "endsAt">,
  now: Date = new Date(),
): PricingCampaignStatus {
  if (!campaign.enabled) return "draft";
  const t = now.getTime();
  if (campaign.endsAt) {
    const end = new Date(campaign.endsAt).getTime();
    if (Number.isFinite(end) && t >= end) return "ended";
  }
  if (campaign.startsAt) {
    const start = new Date(campaign.startsAt).getTime();
    if (Number.isFinite(start) && t < start) return "scheduled";
  }
  return "live";
}

/** Mirrors `public.pricing_campaign_is_active(c)`. */
export function isPricingCampaignActive(
  campaign: Pick<PricingCampaign, "enabled" | "startsAt" | "endsAt">,
  now: Date = new Date(),
): boolean {
  return pricingCampaignStatus(campaign, now) === "live";
}

/**
 * Which campaign the marketing pages actually use.
 *
 * `_pricing_active_campaign_id()` is `… where pricing_campaign_is_active(c)
 * order by c.updated_at desc limit 1` — at most ONE campaign can be in effect,
 * and the most recently updated one wins.
 */
export function resolveEffectiveCampaign(
  campaigns: readonly PricingCampaign[],
  now: Date = new Date(),
): PricingCampaign | null {
  const live = campaigns.filter((c) => isPricingCampaignActive(c, now));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))[0] ?? null;
}

/** Live campaigns that are shadowed by `resolveEffectiveCampaign` (never applied). */
export function shadowedLiveCampaigns(
  campaigns: readonly PricingCampaign[],
  now: Date = new Date(),
): PricingCampaign[] {
  const winner = resolveEffectiveCampaign(campaigns, now);
  if (!winner) return [];
  return campaigns.filter((c) => c.id !== winner.id && isPricingCampaignActive(c, now));
}

function timestamp(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export type CampaignSchedule =
  | { kind: "always" }
  | { kind: "from"; start: string }
  | { kind: "until"; end: string }
  | { kind: "window"; start: string; end: string };

/** Structured (not pre-formatted) so the caller owns locale/formatting. */
export function campaignSchedule(
  campaign: Pick<PricingCampaign, "startsAt" | "endsAt">,
): CampaignSchedule {
  const start = campaign.startsAt;
  const end = campaign.endsAt;
  if (!start && !end) return { kind: "always" };
  if (start && !end) return { kind: "from", start };
  if (!start && end) return { kind: "until", end };
  return { kind: "window", start: start as string, end: end as string };
}

export function describeCampaignSchedule(
  campaign: Pick<PricingCampaign, "startsAt" | "endsAt">,
  format: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): string {
  const s = campaignSchedule(campaign);
  switch (s.kind) {
    case "always":
      return "Always on";
    case "from":
      return `From ${format(s.start)}`;
    case "until":
      return `Until ${format(s.end)}`;
    case "window":
      return `${format(s.start)} → ${format(s.end)}`;
  }
}

export const PLAN_LABELS: Record<PaidPlanCode, string> = {
  starter: "Starter",
  business: "Business",
  waka_plus: "Enterprise (Waka Plus)",
};

/**
 * One line per changed plan: “Starter −10% · Business −UGX 6,000”.
 *
 * The annual percentage is independent of the monthly discount server-side
 * (`_pricing_compute_plan_row` applies it whatever the monthly type is), so a
 * plan carrying only an annual change is reported too — otherwise the list would
 * claim “No discounts” for a plan whose yearly price is discounted.
 */
export function describePlanDiscounts(
  discounts: readonly PricingCampaignPlanDiscount[],
  planLabels: Record<PaidPlanCode, string> = PLAN_LABELS,
): string {
  const parts: string[] = [];
  for (const d of discounts) {
    const label = planLabels[d.planCode];
    const hasMonthly = d.monthlyDiscountType !== "none" && d.monthlyDiscountValue > 0;
    if (hasMonthly) {
      parts.push(
        d.monthlyDiscountType === "percentage"
          ? `${label} −${trimNumber(d.monthlyDiscountValue)}%`
          : `${label} −${formatUgx(d.monthlyDiscountValue)}`,
      );
      continue;
    }
    if (d.annualDiscountPercent !== null && d.annualDiscountPercent > 0) {
      parts.push(`${label} ${trimNumber(d.annualDiscountPercent)}% annual`);
    }
  }
  return parts.join(" · ");
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Validation (client-side; the server keeps its own checks)
// ---------------------------------------------------------------------------

export type CampaignDraft = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  /** `datetime-local` value (local wall clock, no timezone). */
  startsAt: string;
  /** `datetime-local` value (local wall clock, no timezone). */
  endsAt: string;
};

export type CampaignDraftErrors = Partial<Record<"name" | "startsAt" | "endsAt", string>>;

export function validateCampaignDraft(draft: CampaignDraft): CampaignDraftErrors {
  const errors: CampaignDraftErrors = {};
  if (!draft.name.trim()) errors.name = "Enter a campaign name.";

  const start = parseDatetimeLocal(draft.startsAt);
  if (draft.startsAt.trim() && start === null) errors.startsAt = "Enter a valid start date.";
  const end = parseDatetimeLocal(draft.endsAt);
  if (draft.endsAt.trim() && end === null) errors.endsAt = "Enter a valid end date.";

  if (start !== null && end !== null && end <= start) {
    errors.endsAt = "The end date must be after the start date.";
  }
  return errors;
}

export type PlanDiscountDraft = {
  monthlyDiscountType: MonthlyDiscountType;
  /** Raw input string — kept as text so the field can be cleared while typing. */
  monthlyDiscountValue: string;
  /** Raw input string. Blank means “use the canonical annual discount”. */
  annualDiscountPercent: string;
};

export type PlanDiscountDraftErrors = Partial<
  Record<"monthlyDiscountValue" | "annualDiscountPercent" | "reason", string>
>;

/** Fixed discounts cannot push a plan below `MIN_FINAL_MONTHLY_UGX`. */
export function maxFixedDiscountUgx(planCode: PaidPlanCode): number {
  const canonical = CANONICAL_PLAN_PRICES.find((p) => p.planCode === planCode);
  const monthly = canonical?.monthlyPriceUgx ?? 0;
  return Math.max(0, monthly - MIN_FINAL_MONTHLY_UGX);
}

/**
 * `reason` is shared by every plan row in the editor (one field, many saves) —
 * the server records it per save (`admin_…_plan_discount_save` → `reason_required`).
 */
export function validatePlanDiscountDraft(
  planCode: PaidPlanCode,
  draft: PlanDiscountDraft,
  reason: string,
): PlanDiscountDraftErrors {
  const errors: PlanDiscountDraftErrors = {};

  if (!reason.trim()) errors.reason = "A reason is required for every discount change.";

  if (draft.monthlyDiscountType !== "none") {
    const raw = draft.monthlyDiscountValue.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0) {
      errors.monthlyDiscountValue = "Enter a discount amount of 0 or more.";
    } else if (draft.monthlyDiscountType === "percentage" && value > MAX_PERCENTAGE_DISCOUNT) {
      errors.monthlyDiscountValue = `Percentage discounts are capped at ${MAX_PERCENTAGE_DISCOUNT}%.`;
    } else if (draft.monthlyDiscountType === "fixed_amount" && value > maxFixedDiscountUgx(planCode)) {
      errors.monthlyDiscountValue = `${PLAN_LABELS[planCode]} can be discounted by at most ${formatUgx(
        maxFixedDiscountUgx(planCode),
      )} (floor ${formatUgx(MIN_FINAL_MONTHLY_UGX)}).`;
    }
  }

  // `pricing_campaign_plan_discounts.annual_discount_percent` carries no CHECK
  // constraint, and `_pricing_compute_plan_row` does not clamp it — a value
  // above 100 would render a NEGATIVE annual price. Guard it here.
  const annualRaw = draft.annualDiscountPercent.trim();
  if (annualRaw) {
    const annual = Number(annualRaw);
    if (!Number.isFinite(annual) || annual < 0 || annual > MAX_PERCENTAGE_DISCOUNT) {
      errors.annualDiscountPercent = `Enter an annual discount between 0 and ${MAX_PERCENTAGE_DISCOUNT}%.`;
    }
  }

  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((v) => typeof v === "string" && v.length > 0);
}

/** `datetime-local` string (local wall clock) → ISO, or null when unparseable/blank. */
export function parseDatetimeLocal(value: string): Date | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function datetimeLocalFromIso(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/**
 * `admin_pricing_campaign_save` / `…_plan_discount_save` return machine codes
 * (`name_required`, `discount_below_minimum`, …) and `_pricing_require_admin`
 * raises `forbidden`. Raw codes are not actionable for an operator.
 */
export function mapPricingCampaignError(raw: string | null | undefined): string {
  const code = (raw ?? "").trim();
  if (!code) return "Something went wrong. Please try again.";
  switch (code) {
    case "name_required":
      return "Enter a campaign name.";
    case "reason_required":
      return "A reason is required for every discount change.";
    case "invalid_plan":
      return "That plan cannot carry a campaign discount.";
    case "invalid_discount_type":
      return "That discount type is not supported.";
    case "campaign_not_found":
      return "That campaign no longer exists. Refresh the page and try again.";
    case "discount_below_minimum":
      return `The discounted price cannot go below ${formatUgx(MIN_FINAL_MONTHLY_UGX)} per month.`;
    case "forbidden":
    case "Forbidden":
      return "You do not have permission to change pricing campaigns.";
    case "no_supabase":
      return "Supabase is not configured for this build.";
    default:
      break;
  }
  if (code.includes("Could not find the function") || code.includes("PGRST202")) {
    return "The pricing campaign functions are missing on the server. Apply migration 113_pricing_campaigns.sql.";
  }
  return code;
}
