import { describe, expect, it } from "vitest";
import {
  authenticatedVisitorDestination,
  buildMerchantSignupMetadata,
  onboardingGateDecision,
  visitorKindFromIdentity,
} from "./merchantRegistration";
import { merchantIntentFromMetadata } from "./memberIdentity";

/**
 * The three decisions merchant registration makes in the browser, none of which grants anything:
 * what a signup declares, where an authenticated visitor to /register belongs, and what to assume
 * when the server's onboarding answer is missing.
 */

describe("14. onboarding state fails closed", () => {
  it("an unreachable status RPC is NEVER read as complete", () => {
    expect(onboardingGateDecision(null)).toBe("unavailable");
    expect(onboardingGateDecision(undefined)).toBe("unavailable");
  });

  it("reports what the server actually said when it answered", () => {
    expect(onboardingGateDecision({ complete: true })).toBe("complete");
    expect(onboardingGateDecision({ complete: false })).toBe("incomplete");
  });
});

describe("12 & 13. an authenticated visitor to /register is sent where they belong", () => {
  it("an existing merchant goes to their workspace, never the new-owner wizard", () => {
    expect(authenticatedVisitorDestination("merchant")).toBe("/");
  });

  it("a loyalty member goes to the member surface", () => {
    expect(authenticatedVisitorDestination("member")).toBe("/member");
  });

  it("an unknown session is offered the choice — creating a business stays explicit", () => {
    expect(authenticatedVisitorDestination("unknown")).toBe("/welcome");
  });

  it("maps the classifier's kinds without inventing a fourth", () => {
    expect(visitorKindFromIdentity("merchant")).toBe("merchant");
    expect(visitorKindFromIdentity("member")).toBe("member");
    expect(visitorKindFromIdentity("unknown")).toBe("unknown");
    // Anything the classifier might add later is treated as "we do not know", which is the
    // branch that grants nothing.
    expect(visitorKindFromIdentity("something_new")).toBe("unknown");
  });
});

describe("1, 2 & 3. a signup declares intent and nothing more", () => {
  const base = { organizationName: "Kampala Pharmacy", shopDisplayName: "Kampala Pharmacy" };

  it("writes exactly what the identity classifier reads", () => {
    const meta = buildMerchantSignupMetadata({ ...base, businessType: "pharmacy" });
    expect(meta.pos_role).toBe("owner");
    expect(meta.business_name).toBe("Kampala Pharmacy");
    expect(meta.organization_name).toBe("Kampala Pharmacy");
    // The same predicate the server uses, run against the metadata this builds.
    expect(merchantIntentFromMetadata(meta)).toBe(true);
  });

  it("carries no tenancy — no shop, organization or member id is invented here", () => {
    const meta = buildMerchantSignupMetadata({ ...base, businessType: "pharmacy" });
    expect(Object.keys(meta).sort()).toEqual([
      "business_name",
      "business_type",
      "organization_name",
      "pos_role",
      "shop_display_name",
    ]);
    expect(meta).not.toHaveProperty("shop_id");
    expect(meta).not.toHaveProperty("organization_id");
    expect(meta).not.toHaveProperty("member_id");
    expect(meta).not.toHaveProperty("account_kind");
  });

  it("an intent with no business name is not intent at all", () => {
    const meta = buildMerchantSignupMetadata({ organizationName: "", businessType: null });
    expect(merchantIntentFromMetadata(meta)).toBe(false);
  });
});

describe("8 & 17. the business type is the merchant's choice or nothing", () => {
  const base = { organizationName: "Acme", shopDisplayName: "Acme" };

  it("records no business type when nobody has asked yet", () => {
    const meta = buildMerchantSignupMetadata({ ...base, businessType: null });
    // Absent, not defaulted: a claim made at signup becomes the shop's type before the wizard runs.
    expect(meta).not.toHaveProperty("business_type");
  });

  it.each(["kiosk_duka", "pharmacy", "hospitality", "restaurant_bar", "hotel"])(
    "preserves the type the merchant selected: %s",
    (businessType) => {
      const meta = buildMerchantSignupMetadata({ ...base, businessType });
      expect(meta.business_type).toBe(businessType);
    },
  );

  it("still declares merchant intent with no business type — the two are independent", () => {
    const meta = buildMerchantSignupMetadata({ ...base, businessType: null });
    expect(merchantIntentFromMetadata(meta)).toBe(true);
  });
});

describe("the rest of the signup metadata is unchanged", () => {
  it("normalises the referral code, and only when it is long enough", () => {
    expect(
      buildMerchantSignupMetadata({ organizationName: "A", businessType: null, referralCode: " ab12 " })
        .referral_code,
    ).toBe("AB12");
    expect(
      buildMerchantSignupMetadata({ organizationName: "A", businessType: null, referralCode: "ab" }),
    ).not.toHaveProperty("referral_code");
  });

  it("only records GPS when both coordinates are real numbers", () => {
    expect(
      buildMerchantSignupMetadata({
        organizationName: "A",
        businessType: null,
        latitude: 0.31,
        longitude: 32.58,
      }),
    ).toMatchObject({ latitude: 0.31, longitude: 32.58 });

    expect(
      buildMerchantSignupMetadata({
        organizationName: "A",
        businessType: null,
        latitude: Number.NaN,
        longitude: 32.58,
      }),
    ).not.toHaveProperty("latitude");
  });

  it("falls back to the organization name for the shop display name", () => {
    const meta = buildMerchantSignupMetadata({ organizationName: "Acme Ltd", businessType: null });
    expect(meta.shop_display_name).toBe("Acme Ltd");
  });
});
