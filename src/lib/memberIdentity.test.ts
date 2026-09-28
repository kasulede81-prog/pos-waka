import { describe, expect, it } from "vitest";
import {
  merchantIntentFromMetadata,
  memberIntentFromMetadata,
  resolveFromIdentity,
  type AccountIdentity,
} from "./memberIdentity";

/**
 * The classification precedence is the single decision that keeps a loyalty member from being
 * provisioned a shop. These are pure-logic assertions on the rule table, running under the default
 * (node) vitest project — the RPC plumbing around them is covered by the SQL integration suite.
 */

function ident(over: Partial<AccountIdentity> = {}): AccountIdentity {
  return {
    authUserId: "u1",
    isMember: false,
    memberId: null,
    memberStatus: null,
    isShopMember: false,
    shopId: null,
    membershipRole: null,
    isOrgMember: false,
    organizationId: null,
    hasPendingStaffInvite: false,
    merchantIntent: false,
    memberIntent: false,
    profileExists: false,
    ...over,
  };
}

describe("metadata intent readers", () => {
  it("reads merchant intent from what the merchant signup has always written", () => {
    expect(merchantIntentFromMetadata({ pos_role: "owner", business_name: "Kiosk" })).toBe(true);
    expect(merchantIntentFromMetadata({ pos_role: "owner", organization_name: "Org" })).toBe(true);
  });

  it("does not mistake a cashier or an empty name for merchant intent", () => {
    expect(merchantIntentFromMetadata({ pos_role: "cashier", business_name: "Kiosk" })).toBe(false);
    expect(merchantIntentFromMetadata({ pos_role: "owner", business_name: "   " })).toBe(false);
    expect(merchantIntentFromMetadata({ pos_role: "owner" })).toBe(false);
    expect(merchantIntentFromMetadata(null)).toBe(false);
  });

  it("reads member intent from account_kind", () => {
    expect(memberIntentFromMetadata({ account_kind: "member" })).toBe(true);
    expect(memberIntentFromMetadata({ account_kind: "owner" })).toBe(false);
    expect(memberIntentFromMetadata(undefined)).toBe(false);
  });
});

describe("classification precedence", () => {
  it("an existing tenancy always wins — a live merchant is never disrupted", () => {
    expect(resolveFromIdentity(ident({ isShopMember: true }), false)).toMatchObject({
      kind: "merchant",
      reason: "existing_tenancy",
    });
    expect(resolveFromIdentity(ident({ isOrgMember: true }), false).kind).toBe("merchant");
    expect(resolveFromIdentity(ident({ hasPendingStaffInvite: true }), false)).toMatchObject({
      kind: "merchant",
      reason: "pending_staff_invite",
    });
  });

  it("member intent outranks merchant intent, so carrying both cannot force a tenancy", () => {
    const both = ident({ isMember: true, memberIntent: true, merchantIntent: true });
    expect(resolveFromIdentity(both, true).kind).toBe("member");
  });

  it("a member row with no explicit intent is still a member — refuse, do not provision", () => {
    expect(resolveFromIdentity(ident({ isMember: true }), false).kind).toBe("member");
  });

  it("merchant intent alone keeps the merchant path (every existing merchant)", () => {
    expect(resolveFromIdentity(ident({ merchantIntent: true }), false)).toMatchObject({
      kind: "merchant",
      reason: "merchant_intent",
    });
    // Also honoured when only the locally-readable metadata carries it.
    expect(resolveFromIdentity(ident(), true).kind).toBe("merchant");
  });

  it("nothing recognisable resolves to unknown — which provisions nothing", () => {
    const r = resolveFromIdentity(ident(), false);
    expect(r).toMatchObject({ kind: "unknown", reason: "unclassified" });
  });

  it("flags are read independently, never collapsed into one value", () => {
    // merchant AND member at once must be representable rather than one silently winning.
    const r = resolveFromIdentity(ident({ isShopMember: true, isMember: true, memberIntent: true }), true);
    expect(r.identity?.isShopMember).toBe(true);
    expect(r.identity?.isMember).toBe(true);
  });
});
