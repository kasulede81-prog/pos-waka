import { describe, expect, it } from "vitest";
import {
  blocksOwnerBootstrap,
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

/**
 * Phase 2B — the states the member registration flow actually moves between.
 *
 * `becomeLoyaltyMember` writes member intent and then invalidates the cache, so the classifier sees
 * exactly these shapes on the next resolve. Getting one of them wrong is what sends a new member to
 * the wrong surface, so they are pinned here rather than left to the SQL suite (which cannot see
 * metadata at all).
 */
describe("Phase 2B: registration states", () => {
  it("member intent WITHOUT a member row is unknown — intent alone never makes a member", () => {
    // This is the state a member-intent signup sits in until they complete registration, and the
    // state an abandoned registration is left in. It must provision nothing and land on /welcome.
    const r = resolveFromIdentity(ident({ memberIntent: true, isMember: false }), false);
    expect(r).toMatchObject({ kind: "unknown", reason: "unclassified" });
  });

  it("member intent WITH a member row is a member — the state registration produces", () => {
    const r = resolveFromIdentity(ident({ memberIntent: true, isMember: true, memberId: "m1" }), false);
    expect(r).toMatchObject({ kind: "member", memberId: "m1" });
  });

  it("a merchant who joins loyalty keeps the merchant path", () => {
    // Phase 2B writes account_kind='member' for everyone who registers, merchants included. The
    // tenancy check runs first, so a real merchant is never displaced by their own loyalty row.
    const r = resolveFromIdentity(
      ident({ isShopMember: true, shopId: "s1", isMember: true, memberIntent: true }),
      false,
    );
    expect(r).toMatchObject({ kind: "merchant", reason: "existing_tenancy" });
  });

  it("an abandoned-merchant signup that joins loyalty becomes a member", () => {
    // Merchant metadata, no tenancy, plus a member row: member intent outranks merchant intent.
    const r = resolveFromIdentity(
      ident({ merchantIntent: true, isMember: true, memberIntent: true }),
      true,
    );
    expect(r.kind).toBe("member");
  });
});

describe("Phase 2B: blocksOwnerBootstrap is the last line of defence", () => {
  it("permits the owner bootstrap for a merchant and NOTHING else", () => {
    expect(blocksOwnerBootstrap({ kind: "merchant", reason: "existing_tenancy", identity: null })).toBe(false);
    expect(blocksOwnerBootstrap({ kind: "member", memberId: "m1", identity: ident({ isMember: true }) })).toBe(true);
    expect(blocksOwnerBootstrap({ kind: "unknown", reason: "unclassified", identity: null })).toBe(true);
  });

  it("blocks a member and an unclassified session even when a tenancy is absent", () => {
    // The bug Phase 1 removed was an authenticated stranger being silently made a shop owner, so
    // the refusal must be the default rather than something the caller opts into.
    const member = resolveFromIdentity(ident({ memberIntent: true, isMember: true }), false);
    const unknown = resolveFromIdentity(ident(), false);
    const merchant = resolveFromIdentity(ident({ merchantIntent: true }), false);
    expect([blocksOwnerBootstrap(member), blocksOwnerBootstrap(unknown)]).toEqual([true, true]);
    expect(blocksOwnerBootstrap(merchant)).toBe(false);
  });
});
