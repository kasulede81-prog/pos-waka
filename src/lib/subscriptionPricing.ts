/**
 * Canonical subscription list prices and campaign discount math.
 * Canonical values are protected — campaigns never overwrite these.
 */
import type { SubscriptionPlanCode } from "./subscriptionEntitlements";

export type PaidPlanCode = Exclude<SubscriptionPlanCode, "free">;

export type MonthlyDiscountType = "none" | "fixed_amount" | "percentage";

export type CanonicalPlanPrice = {
  planCode: PaidPlanCode;
  monthlyPriceUgx: number;
  defaultAnnualDiscountPercent: number;
};

/** Protected canonical prices — source of truth for marketing display. */
export const CANONICAL_PLAN_PRICES: readonly CanonicalPlanPrice[] = [
  { planCode: "starter", monthlyPriceUgx: 18_000, defaultAnnualDiscountPercent: 20 },
  { planCode: "business", monthlyPriceUgx: 36_000, defaultAnnualDiscountPercent: 20 },
  { planCode: "waka_plus", monthlyPriceUgx: 82_000, defaultAnnualDiscountPercent: 20 },
] as const;

export const MIN_FINAL_MONTHLY_UGX = 5_000;
export const MAX_PERCENTAGE_DISCOUNT = 90;

export type PlanDiscountInput = {
  monthlyDiscountType: MonthlyDiscountType;
  monthlyDiscountValue: number;
  annualDiscountPercent?: number | null;
};

export type ComputedPlanPrice = {
  planCode: PaidPlanCode;
  originalMonthlyUgx: number;
  monthlyDiscountUgx: number;
  finalMonthlyUgx: number;
  originalAnnualFullUgx: number;
  finalAnnualUgx: number;
  annualDiscountPercent: number;
  hasMonthlyDiscount: boolean;
  hasAnnualDiscount: boolean;
  /**
   * The campaign layer before any administrative discount. Published by the
   * server; absent from a locally computed row.
   */
  campaignMonthlyUgx?: number;
  campaignAnnualUgx?: number;
  /** The live GLOBAL administrative discount, if one applies to this plan. */
  globalDiscountPercent?: number;
};

export function canonicalPriceForPlan(planCode: PaidPlanCode): CanonicalPlanPrice {
  const row = CANONICAL_PLAN_PRICES.find((p) => p.planCode === planCode);
  if (!row) throw new Error(`unknown plan: ${planCode}`);
  return row;
}

export function computePlanDisplayPrice(
  planCode: PaidPlanCode,
  discount: PlanDiscountInput = {
    monthlyDiscountType: "none",
    monthlyDiscountValue: 0,
    annualDiscountPercent: null,
  },
): ComputedPlanPrice {
  const canonical = canonicalPriceForPlan(planCode);
  const originalMonthly = canonical.monthlyPriceUgx;
  const annualPct = discount.annualDiscountPercent ?? canonical.defaultAnnualDiscountPercent;

  let finalMonthly = originalMonthly;

  if (discount.monthlyDiscountType === "fixed_amount") {
    const maxDiscount = Math.max(0, originalMonthly - MIN_FINAL_MONTHLY_UGX);
    const requested = Math.min(Math.max(0, Math.round(discount.monthlyDiscountValue)), maxDiscount);
    finalMonthly = originalMonthly - requested;
  } else if (discount.monthlyDiscountType === "percentage") {
    const pct = Math.min(Math.max(discount.monthlyDiscountValue, 0), MAX_PERCENTAGE_DISCOUNT);
    finalMonthly = Math.max(MIN_FINAL_MONTHLY_UGX, originalMonthly - Math.round((originalMonthly * pct) / 100));
  }

  // Derived from the final price, never from the requested percentage: the floor
  // can make the real discount smaller than the one asked for (90% of 18,000 is
  // 16,200, but the price only falls to 5,000). The server derives the same
  // figure the same way in `_pricing_compute_plan_row` (migration
  // 20261011160000), and a pinned test asserts this mirror equals it for every
  // plan and discount shape.
  const monthlyDiscount = originalMonthly - finalMonthly;

  const originalAnnualFull = originalMonthly * 12;
  const finalAnnual = Math.round(finalMonthly * 12 * (1 - annualPct / 100));

  return {
    planCode,
    originalMonthlyUgx: originalMonthly,
    monthlyDiscountUgx: monthlyDiscount,
    finalMonthlyUgx: finalMonthly,
    originalAnnualFullUgx: originalAnnualFull,
    finalAnnualUgx: finalAnnual,
    annualDiscountPercent: annualPct,
    hasMonthlyDiscount: monthlyDiscount > 0,
    hasAnnualDiscount: annualPct > 0,
  };
}

export type PublicPricingSnapshot = {
  campaignId: string | null;
  campaignName: string | null;
  campaignActive: boolean;
  /**
   * True when a GLOBAL administrative discount is live on any plan. The book
   * already carries its effect in `finalMonthlyUgx`; this exists so the page can
   * say why the price is lower than the campaign alone would explain. An
   * ACCOUNT discount never appears here — it is private to its organization.
   */
  globalDiscountActive: boolean;
  plans: ComputedPlanPrice[];
  asOf: string;
};

export function buildDefaultPublicPricing(): PublicPricingSnapshot {
  return {
    campaignId: null,
    campaignName: null,
    campaignActive: false,
    globalDiscountActive: false,
    plans: CANONICAL_PLAN_PRICES.map((p) =>
      computePlanDisplayPrice(p.planCode, {
        monthlyDiscountType: "none",
        monthlyDiscountValue: 0,
      }),
    ),
    asOf: new Date().toISOString(),
  };
}

type RpcPlanRow = {
  plan_code: string;
  original_monthly_ugx: number;
  monthly_discount_ugx: number;
  final_monthly_ugx: number;
  original_annual_full_ugx: number;
  final_annual_ugx: number;
  annual_discount_percent: number;
  has_monthly_discount: boolean;
  has_annual_discount: boolean;
  /** The campaign layer, before any administrative discount. */
  campaign_monthly_ugx?: number;
  campaign_annual_ugx?: number;
  global_discount_percent?: number;
};

export function mapPublicPricingRpc(data: unknown): PublicPricingSnapshot {
  const obj = (data ?? {}) as Record<string, unknown>;
  const plansRaw = Array.isArray(obj.plans) ? obj.plans : [];
  const plans = plansRaw
    .map((row) => {
      const r = row as RpcPlanRow;
      const rawCode = String(r.plan_code ?? "");
      if (!rawCode || rawCode === "free") return null;
      const code = rawCode as PaidPlanCode;
      const plan: ComputedPlanPrice = {
        planCode: code,
        originalMonthlyUgx: Number(r.original_monthly_ugx),
        monthlyDiscountUgx: Number(r.monthly_discount_ugx),
        finalMonthlyUgx: Number(r.final_monthly_ugx),
        originalAnnualFullUgx: Number(r.original_annual_full_ugx),
        finalAnnualUgx: Number(r.final_annual_ugx),
        annualDiscountPercent: Number(r.annual_discount_percent),
        hasMonthlyDiscount: Boolean(r.has_monthly_discount),
        hasAnnualDiscount: Boolean(r.has_annual_discount),
      };
      // Present only once the server publishes them; an older deployment simply
      // omits them and the prices above remain the campaign-layer ones.
      if (r.campaign_monthly_ugx !== undefined) plan.campaignMonthlyUgx = Number(r.campaign_monthly_ugx);
      if (r.campaign_annual_ugx !== undefined) plan.campaignAnnualUgx = Number(r.campaign_annual_ugx);
      if (r.global_discount_percent !== undefined) plan.globalDiscountPercent = Number(r.global_discount_percent);
      return plan;
    })
    .filter((p): p is ComputedPlanPrice => p !== null);

  return {
    campaignId: typeof obj.campaign_id === "string" ? obj.campaign_id : null,
    campaignName: typeof obj.campaign_name === "string" ? obj.campaign_name : null,
    campaignActive: Boolean(obj.campaign_active),
    globalDiscountActive:
      typeof obj.global_discount_active === "boolean"
        ? obj.global_discount_active
        : plans.some((p) => (p.globalDiscountPercent ?? 0) > 0),
    plans: plans.length > 0 ? plans : buildDefaultPublicPricing().plans,
    asOf: typeof obj.as_of === "string" ? obj.as_of : new Date().toISOString(),
  };
}

export function pricingForPlan(
  snapshot: PublicPricingSnapshot,
  planCode: PaidPlanCode,
): ComputedPlanPrice {
  return (
    snapshot.plans.find((p) => p.planCode === planCode) ??
    computePlanDisplayPrice(planCode, { monthlyDiscountType: "none", monthlyDiscountValue: 0 })
  );
}

export function formatUgx(amount: number): string {
  return `UGX ${amount.toLocaleString("en-UG")}`;
}

export function enterpriseLabel(planCode: PaidPlanCode): string {
  return planCode === "waka_plus" ? "Enterprise (Waka Plus)" : planCode;
}
