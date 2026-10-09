import { describe, expect, it } from "vitest";
import {
  datetimeLocalFromIso,
  describeCampaignSchedule,
  describePlanDiscounts,
  hasErrors,
  isPricingCampaignActive,
  mapPricingCampaignError,
  parseDatetimeLocal,
  pricingCampaignStatus,
  resolveEffectiveCampaign,
  shadowedLiveCampaigns,
  validateCampaignDraft,
  validatePlanDiscountDraft,
  type CampaignDraft,
  type PricingCampaign,
  type PricingCampaignPlanDiscount,
} from "./pricingCampaigns";

const NOW = new Date("2026-10-09T12:00:00Z");
const HOUR = 3_600_000;

function campaign(overrides: Partial<PricingCampaign> = {}): PricingCampaign {
  return {
    id: "c1",
    name: "Campaign",
    description: "",
    enabled: true,
    startsAt: null,
    endsAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function discount(overrides: Partial<PricingCampaignPlanDiscount> = {}): PricingCampaignPlanDiscount {
  return {
    id: "d1",
    campaignId: "c1",
    planCode: "starter",
    monthlyDiscountType: "percentage",
    monthlyDiscountValue: 10,
    annualDiscountPercent: null,
    ...overrides,
  };
}

describe("pricingCampaignStatus", () => {
  it("treats a disabled campaign as a draft whatever the schedule says", () => {
    expect(pricingCampaignStatus(campaign({ enabled: false }), NOW)).toBe("draft");
    expect(
      pricingCampaignStatus(
        campaign({ enabled: false, startsAt: null, endsAt: null }),
        NOW,
      ),
    ).toBe("draft");
  });

  it("is live when enabled with no schedule", () => {
    expect(pricingCampaignStatus(campaign(), NOW)).toBe("live");
  });

  it("is scheduled when the start is still in the future", () => {
    expect(
      pricingCampaignStatus(campaign({ startsAt: new Date(NOW.getTime() + HOUR).toISOString() }), NOW),
    ).toBe("scheduled");
  });

  it("is live once the start has passed and the end has not", () => {
    expect(
      pricingCampaignStatus(
        campaign({
          startsAt: new Date(NOW.getTime() - HOUR).toISOString(),
          endsAt: new Date(NOW.getTime() + HOUR).toISOString(),
        }),
        NOW,
      ),
    ).toBe("live");
  });

  it("is ended once now reaches ends_at — the boundary matches the server's `now() < ends_at`", () => {
    expect(pricingCampaignStatus(campaign({ endsAt: NOW.toISOString() }), NOW)).toBe("ended");
    expect(
      pricingCampaignStatus(campaign({ endsAt: new Date(NOW.getTime() + 1).toISOString() }), NOW),
    ).toBe("live");
  });

  it("reads an end-before-start row as ended rather than scheduled", () => {
    // The server never rejected this shape; reporting it as "Scheduled" would
    // claim a campaign is still going to run when it never can.
    expect(
      pricingCampaignStatus(
        campaign({
          startsAt: new Date(NOW.getTime() + HOUR).toISOString(),
          endsAt: new Date(NOW.getTime() - HOUR).toISOString(),
        }),
        NOW,
      ),
    ).toBe("ended");
  });

  it("ignores an unparseable timestamp instead of throwing", () => {
    expect(pricingCampaignStatus(campaign({ startsAt: "not-a-date" }), NOW)).toBe("live");
  });

  it("agrees with isPricingCampaignActive", () => {
    const rows = [
      campaign({ id: "a", enabled: false }),
      campaign({ id: "b" }),
      campaign({ id: "c", startsAt: new Date(NOW.getTime() + HOUR).toISOString() }),
      campaign({ id: "d", endsAt: new Date(NOW.getTime() - HOUR).toISOString() }),
    ];
    for (const row of rows) {
      expect(isPricingCampaignActive(row, NOW)).toBe(pricingCampaignStatus(row, NOW) === "live");
    }
  });
});

describe("resolveEffectiveCampaign", () => {
  it("returns null when nothing is live", () => {
    expect(resolveEffectiveCampaign([], NOW)).toBeNull();
    expect(resolveEffectiveCampaign([campaign({ enabled: false })], NOW)).toBeNull();
    expect(
      resolveEffectiveCampaign([campaign({ endsAt: new Date(NOW.getTime() - HOUR).toISOString() })], NOW),
    ).toBeNull();
  });

  it("returns the single live campaign", () => {
    const live = campaign({ id: "live" });
    expect(resolveEffectiveCampaign([campaign({ id: "off", enabled: false }), live], NOW)?.id).toBe("live");
  });

  it("mirrors _pricing_active_campaign_id: the most recently updated live campaign wins", () => {
    const older = campaign({ id: "older", updatedAt: "2026-10-05T00:00:00Z" });
    const newer = campaign({ id: "newer", updatedAt: "2026-10-08T00:00:00Z" });
    expect(resolveEffectiveCampaign([older, newer], NOW)?.id).toBe("newer");
    expect(resolveEffectiveCampaign([newer, older], NOW)?.id).toBe("newer");
  });

  it("does not let a newer draft outrank a live campaign", () => {
    const live = campaign({ id: "live", updatedAt: "2026-10-01T00:00:00Z" });
    const draft = campaign({ id: "draft", enabled: false, updatedAt: "2026-10-09T00:00:00Z" });
    expect(resolveEffectiveCampaign([draft, live], NOW)?.id).toBe("live");
  });

  it("tolerates a missing updated_at rather than picking it first", () => {
    const stamped = campaign({ id: "stamped", updatedAt: "2026-10-01T00:00:00Z" });
    const blank = campaign({ id: "blank", updatedAt: "" });
    expect(resolveEffectiveCampaign([blank, stamped], NOW)?.id).toBe("stamped");
  });
});

describe("shadowedLiveCampaigns", () => {
  it("is empty when at most one campaign is live", () => {
    expect(shadowedLiveCampaigns([], NOW)).toEqual([]);
    expect(shadowedLiveCampaigns([campaign()], NOW)).toEqual([]);
  });

  it("names the live campaigns that never apply", () => {
    const older = campaign({ id: "older", updatedAt: "2026-10-05T00:00:00Z" });
    const newer = campaign({ id: "newer", updatedAt: "2026-10-08T00:00:00Z" });
    const draft = campaign({ id: "draft", enabled: false });
    expect(shadowedLiveCampaigns([older, newer, draft], NOW).map((c) => c.id)).toEqual(["older"]);
  });
});

describe("campaign schedule", () => {
  it("classifies the four shapes", () => {
    expect(describeCampaignSchedule(campaign(), () => "x")).toBe("Always on");
    expect(describeCampaignSchedule(campaign({ startsAt: "2026-01-01T00:00:00Z" }), () => "S")).toBe("From S");
    expect(describeCampaignSchedule(campaign({ endsAt: "2026-01-01T00:00:00Z" }), () => "E")).toBe("Until E");
    expect(
      describeCampaignSchedule(
        campaign({ startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" }),
        (iso) => iso.slice(5, 7),
      ),
    ).toBe("01 → 02");
  });
});

describe("describePlanDiscounts", () => {
  it("summarises only the plans that actually carry a discount", () => {
    expect(
      describePlanDiscounts([
        discount({ planCode: "starter", monthlyDiscountType: "percentage", monthlyDiscountValue: 10 }),
        discount({ planCode: "business", monthlyDiscountType: "fixed_amount", monthlyDiscountValue: 6_000 }),
        discount({ planCode: "waka_plus", monthlyDiscountType: "none", monthlyDiscountValue: 0 }),
      ]),
    ).toBe("Starter −10% · Business −UGX 6,000");
  });

  it("reports a plan whose only change is the annual percentage", () => {
    // The annual discount applies whatever the monthly type is, so hiding it
    // would make the list claim "No discounts" for a discounted yearly price.
    expect(
      describePlanDiscounts([
        discount({ planCode: "starter", monthlyDiscountType: "none", monthlyDiscountValue: 0, annualDiscountPercent: 25 }),
      ]),
    ).toBe("Starter 25% annual");
  });

  it("prefers the monthly figure when a plan has both", () => {
    expect(
      describePlanDiscounts([
        discount({ planCode: "business", monthlyDiscountType: "fixed_amount", monthlyDiscountValue: 6_000, annualDiscountPercent: 25 }),
      ]),
    ).toBe("Business −UGX 6,000");
  });

  it("is empty when a campaign has no discounts", () => {
    expect(describePlanDiscounts([])).toBe("");
    expect(describePlanDiscounts([discount({ monthlyDiscountType: "none", monthlyDiscountValue: 0, annualDiscountPercent: null })])).toBe("");
    expect(describePlanDiscounts([discount({ monthlyDiscountType: "none", monthlyDiscountValue: 0, annualDiscountPercent: 0 })])).toBe("");
  });
});

describe("validateCampaignDraft", () => {
  const base: CampaignDraft = {
    id: null,
    name: "Q2 launch",
    description: "",
    enabled: true,
    startsAt: "",
    endsAt: "",
  };

  it("accepts a well-formed draft", () => {
    expect(hasErrors(validateCampaignDraft(base))).toBe(false);
    expect(
      hasErrors(validateCampaignDraft({ ...base, startsAt: "2026-10-01T08:00", endsAt: "2026-10-31T08:00" })),
    ).toBe(false);
  });

  it("requires a name — the server answers `name_required`", () => {
    const errors = validateCampaignDraft({ ...base, name: "   " });
    expect(errors.name).toBeTruthy();
    expect(hasErrors(errors)).toBe(true);
  });

  it("rejects an end that is not after the start", () => {
    expect(
      validateCampaignDraft({ ...base, startsAt: "2026-10-31T08:00", endsAt: "2026-10-01T08:00" }).endsAt,
    ).toBeTruthy();
    // Equal timestamps leave a zero-length window that can never be live.
    expect(
      validateCampaignDraft({ ...base, startsAt: "2026-10-01T08:00", endsAt: "2026-10-01T08:00" }).endsAt,
    ).toBeTruthy();
  });

  it("does not invent an error for a draft with no schedule at all", () => {
    const errors = validateCampaignDraft(base);
    expect(errors.startsAt).toBeUndefined();
    expect(errors.endsAt).toBeUndefined();
  });
});

describe("validatePlanDiscountDraft", () => {
  const base = { monthlyDiscountType: "percentage" as const, monthlyDiscountValue: "10", annualDiscountPercent: "" };

  it("requires the audit reason the server demands", () => {
    expect(validatePlanDiscountDraft("starter", base, "").reason).toBeTruthy();
    expect(validatePlanDiscountDraft("starter", base, "   ").reason).toBeTruthy();
    expect(hasErrors(validatePlanDiscountDraft("starter", base, "Q2 launch"))).toBe(false);
  });

  it("caps percentage discounts at the server's clamp", () => {
    expect(
      validatePlanDiscountDraft("starter", { ...base, monthlyDiscountValue: "90" }, "r").monthlyDiscountValue,
    ).toBeUndefined();
    expect(
      validatePlanDiscountDraft("starter", { ...base, monthlyDiscountValue: "91" }, "r").monthlyDiscountValue,
    ).toBeTruthy();
  });

  it("rejects a fixed discount that would breach the minimum monthly price", () => {
    // Starter is UGX 18,000 with a UGX 5,000 floor → at most 13,000 off.
    expect(
      validatePlanDiscountDraft(
        "starter",
        { ...base, monthlyDiscountType: "fixed_amount", monthlyDiscountValue: "13000" },
        "r",
      ).monthlyDiscountValue,
    ).toBeUndefined();
    expect(
      validatePlanDiscountDraft(
        "starter",
        { ...base, monthlyDiscountType: "fixed_amount", monthlyDiscountValue: "13001" },
        "r",
      ).monthlyDiscountValue,
    ).toBeTruthy();
  });

  it("rejects a negative or non-numeric amount", () => {
    for (const value of ["-1", "", "abc"]) {
      expect(validatePlanDiscountDraft("starter", { ...base, monthlyDiscountValue: value }, "r").monthlyDiscountValue).toBeTruthy();
    }
  });

  it("ignores the amount when the plan carries no discount", () => {
    expect(
      hasErrors(
        validatePlanDiscountDraft(
          "starter",
          { monthlyDiscountType: "none", monthlyDiscountValue: "", annualDiscountPercent: "" },
          "r",
        ),
      ),
    ).toBe(false);
  });

  it("keeps the annual percent inside the range the canonical column enforces", () => {
    // `pricing_campaign_plan_discounts.annual_discount_percent` has no CHECK and
    // the server does not clamp it — 150% would render a negative annual price.
    expect(
      validatePlanDiscountDraft("starter", { ...base, annualDiscountPercent: "150" }, "r").annualDiscountPercent,
    ).toBeTruthy();
    expect(
      validatePlanDiscountDraft("starter", { ...base, annualDiscountPercent: "-1" }, "r").annualDiscountPercent,
    ).toBeTruthy();
    expect(
      validatePlanDiscountDraft("starter", { ...base, annualDiscountPercent: "90" }, "r").annualDiscountPercent,
    ).toBeUndefined();
    expect(
      validatePlanDiscountDraft("starter", { ...base, annualDiscountPercent: "" }, "r").annualDiscountPercent,
    ).toBeUndefined();
  });
});

describe("mapPricingCampaignError", () => {
  it("translates every code the RPCs return", () => {
    expect(mapPricingCampaignError("name_required")).toBe("Enter a campaign name.");
    expect(mapPricingCampaignError("reason_required")).toContain("reason");
    expect(mapPricingCampaignError("campaign_not_found")).toContain("no longer exists");
    expect(mapPricingCampaignError("discount_below_minimum")).toContain("UGX 5,000");
    expect(mapPricingCampaignError("forbidden")).toContain("permission");
    expect(mapPricingCampaignError("Forbidden")).toContain("permission");
    expect(mapPricingCampaignError("no_supabase")).toContain("Supabase");
  });

  it("explains a missing migration instead of leaking the PostgREST error", () => {
    expect(mapPricingCampaignError("Could not find the function public.admin_pricing_campaign_save")).toContain(
      "113_pricing_campaigns.sql",
    );
    expect(mapPricingCampaignError("PGRST202")).toContain("113_pricing_campaigns.sql");
  });

  it("passes an unknown message through rather than hiding it", () => {
    expect(mapPricingCampaignError("connection reset by peer")).toBe("connection reset by peer");
  });

  it("never renders an empty banner", () => {
    expect(mapPricingCampaignError("")).not.toBe("");
    expect(mapPricingCampaignError(null)).not.toBe("");
    expect(mapPricingCampaignError(undefined)).not.toBe("");
  });
});

describe("datetime-local bridging", () => {
  it("round-trips an ISO timestamp to the minute", () => {
    const iso = "2026-10-09T14:37:00.000Z";
    const local = datetimeLocalFromIso(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(parseDatetimeLocal(local)?.getTime()).toBe(
      new Date(iso).getTime() - (new Date(iso).getSeconds() * 1000 + new Date(iso).getMilliseconds()),
    );
  });

  it("returns empty/null for absent or invalid input", () => {
    expect(datetimeLocalFromIso(null)).toBe("");
    expect(datetimeLocalFromIso("nonsense")).toBe("");
    expect(parseDatetimeLocal("")).toBeNull();
    expect(parseDatetimeLocal("   ")).toBeNull();
  });
});
