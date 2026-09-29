import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2B — the client half of member registration.
 *
 * These mock the RPC boundary so the assertions are about the ORCHESTRATION, which is where the
 * mistakes live: the order of the member row versus the metadata hint, the cache invalidation that
 * decides whether a new member is actually routed to `/member`, canonicalisation before the value
 * leaves the client, and merging metadata rather than replacing it.
 *
 * The database half — that `loyalty_member_register()` resolves the caller from `auth.uid()`, is
 * idempotent, and creates no organization/shop/profile — is covered by
 * `loyalty/loyaltyMemberIdentity.sql.integration.test.ts`.
 */

const rpc = vi.fn();
const updateUser = vi.fn();
const getUser = vi.fn();

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      updateUser: (...a: unknown[]) => updateUser(...a),
      getUser: (...a: unknown[]) => getUser(...a),
    },
  },
}));

const { becomeLoyaltyMember, memberRegistrationErrorText } = await import("./memberRegistration");
const { resolveAccountIdentity, resetMemberIdentityCache } = await import("./memberIdentity");

const ORDER: string[] = [];

beforeEach(() => {
  ORDER.length = 0;
  rpc.mockReset();
  updateUser.mockReset();
  getUser.mockReset();
  resetMemberIdentityCache();
  getUser.mockResolvedValue({ data: { user: { user_metadata: { pos_role: "owner", business_name: "Kiosk" } } } });
  updateUser.mockImplementation(async () => {
    ORDER.push("metadata");
    return { data: { user: {} }, error: null };
  });
});

describe("becomeLoyaltyMember — canonicalisation at the boundary", () => {
  it("sends the canonical E.164 form for every accepted spelling", async () => {
    for (const spelling of ["0772123456", "256772123456", "+256772123456", "772123456", "0772 123 456"]) {
      rpc.mockReset();
      rpc.mockImplementation(async () => {
        ORDER.push("rpc");
        return { data: { ok: true, member_id: "m1", status: "active", created: true }, error: null };
      });
      const r = await becomeLoyaltyMember({ displayName: "John", phone: spelling });
      expect(r.ok, spelling).toBe(true);
      expect(rpc.mock.calls[0]![1], spelling).toMatchObject({ p_phone_e164: "+256772123456" });
    }
  });

  it("trims the display name and refuses a blank or over-long one before calling the RPC", async () => {
    expect(await becomeLoyaltyMember({ displayName: "   ", phone: "0772123456" })).toEqual({
      ok: false,
      error: "invalid_name",
    });
    expect(await becomeLoyaltyMember({ displayName: "x".repeat(121), phone: "0772123456" })).toEqual({
      ok: false,
      error: "invalid_name",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an uncanonicalisable phone WITHOUT calling the RPC", async () => {
    const r = await becomeLoyaltyMember({ displayName: "John", phone: "nonsense" });
    expect(r).toEqual({ ok: false, error: "invalid_phone" });
    // Nothing left the client — the database CHECK would only have refused it anyway.
    expect(rpc).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("becomeLoyaltyMember — ordering and safety", () => {
  it("creates the member row BEFORE writing the metadata hint", async () => {
    rpc.mockImplementation(async () => {
      ORDER.push("rpc");
      return { data: { ok: true, member_id: "m1", status: "active", created: true }, error: null };
    });
    await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    // The reverse order could strand a user with member intent and no member row — which
    // classifies as `unknown` and would bounce them out of the merchant branch.
    expect(ORDER).toEqual(["rpc", "metadata"]);
  });

  it("MERGES metadata so a merchant joining loyalty keeps merchant intent", async () => {
    rpc.mockResolvedValue({ data: { ok: true, member_id: "m1", status: "active", created: true }, error: null });
    await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    const payload = updateUser.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({
      account_kind: "member",
      pos_role: "owner",
      business_name: "Kiosk",
    });
  });

  it("does not write metadata again when member intent is already recorded", async () => {
    getUser.mockResolvedValue({ data: { user: { user_metadata: { account_kind: "member" } } } });
    rpc.mockResolvedValue({ data: { ok: true, member_id: "m1", status: "active", created: false }, error: null });
    await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("a metadata failure NEVER fails a registration that already succeeded", async () => {
    updateUser.mockRejectedValue(new Error("network"));
    rpc.mockResolvedValue({ data: { ok: true, member_id: "m1", status: "active", created: true }, error: null });
    const r = await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    expect(r).toEqual({ ok: true, memberId: "m1", status: "active", created: true });
  });

  it("surfaces an RPC refusal and writes nothing", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "not_authenticated" }, error: null });
    const r = await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    expect(r).toEqual({ ok: false, error: "not_authenticated" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("is idempotent — a second registration reports created:false, not an error", async () => {
    rpc.mockResolvedValue({ data: { ok: true, member_id: "m1", status: "active", created: true }, error: null });
    const first = await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    rpc.mockResolvedValue({ data: { ok: true, member_id: "m1", status: "active", created: false }, error: null });
    const second = await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && second.created).toBe(false);
    expect(second.ok && second.memberId).toBe("m1");
  });
});

describe("becomeLoyaltyMember — the identity cache must not go stale", () => {
  it("invalidates the cached classification so routing picks the member up", async () => {
    // Classify as `unknown` first — the state a not-yet-registered session is in.
    rpc.mockResolvedValue({ data: { ok: false, error: "identity_failed" }, error: null });
    const before = await resolveAccountIdentity({ userId: "u1", metadata: {} });
    expect(before.kind).toBe("unknown");

    // Register successfully.
    rpc.mockResolvedValue({ data: { ok: true, member_id: "m1", status: "active", created: true }, error: null });
    await becomeLoyaltyMember({ displayName: "John", phone: "0772123456" });

    // The classifier now reports a member row. Without the invalidation inside
    // becomeLoyaltyMember the cached `unknown` would still be returned here — which is exactly
    // the bug that sends a brand-new member back to /welcome.
    rpc.mockResolvedValue({
      data: { ok: true, auth_user_id: "u1", is_member: true, member_id: "m1", member_status: "active", member_intent: true },
      error: null,
    });
    const after = await resolveAccountIdentity({ userId: "u1", metadata: { account_kind: "member" } });
    expect(after.kind).toBe("member");
  });

  it("the cache really is sticky — proving the invalidation is what fixes routing", async () => {
    // The counterfactual, pinned so the test above cannot pass for the wrong reason: with the
    // cache populated, a server that has started reporting a member still gets overruled.
    rpc.mockResolvedValue({ data: { ok: false, error: "identity_failed" }, error: null });
    expect((await resolveAccountIdentity({ userId: "u2", metadata: {} })).kind).toBe("unknown");

    rpc.mockResolvedValue({
      data: { ok: true, is_member: true, member_id: "m9", member_intent: true },
      error: null,
    });
    expect((await resolveAccountIdentity({ userId: "u2", metadata: {} })).kind).toBe("unknown");

    resetMemberIdentityCache();
    expect((await resolveAccountIdentity({ userId: "u2", metadata: {} })).kind).toBe("member");
  });
});

describe("memberRegistrationErrorText", () => {
  it("explains a bad phone in terms the member can act on", () => {
    expect(memberRegistrationErrorText("invalid_phone")).toMatch(/phone/i);
    expect(memberRegistrationErrorText("invalid_phone")).not.toMatch(/invalid_phone/);
  });

  it("never leaks a raw error code to the member", () => {
    for (const code of [
      "invalid_phone",
      "invalid_name",
      "not_authenticated",
      "offline",
      "unavailable",
      // Phase 2F — the RPC's refusal to create a phone-less member must reach the member as
      // guidance too, not as a code.
      "phone_required",
      "weird",
    ]) {
      expect(memberRegistrationErrorText(code), code).not.toContain(code);
    }
  });

  it("explains the phone-required refusal as an instruction, not a dead end", () => {
    expect(memberRegistrationErrorText("phone_required")).toMatch(/phone/i);
    // Specifically distinct from the unparseable-phone message: the fix is to enter one, not to
    // correct a typo.
    expect(memberRegistrationErrorText("phone_required")).not.toBe(memberRegistrationErrorText("invalid_phone"));
  });
});
