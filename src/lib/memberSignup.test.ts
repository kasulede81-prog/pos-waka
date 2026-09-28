import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2B — public member signup.
 *
 * The signup itself is a thin wrapper, so these tests are almost entirely about the ONE property
 * that matters and is easy to lose in a refactor: **a member signup must never be able to produce a
 * merchant workspace.** The most valuable test in this file is the last one.
 *
 * `bootstrapOwnerWorkspace` is mocked with a spy that records every call, so "did not bootstrap"
 * is asserted against the actual bootstrap function rather than inferred from the metadata.
 */

const signUp = vi.fn();
const signInWithPassword = vi.fn();
const rpc = vi.fn();
const bootstrapOwnerWorkspace = vi.fn();

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
    },
  },
}));

vi.mock("./workspaceBootstrap", () => ({
  bootstrapOwnerWorkspace: (...a: unknown[]) => bootstrapOwnerWorkspace(...a),
}));

vi.mock("./authConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./authConfig")>();
  return { ...actual, getAuthEmailCallbackUrl: () => "https://waka.ug/auth/callback" };
});

const { signUpLoyaltyMember } = await import("./memberSignup");

const OK_NO_SESSION = { data: { user: { id: "u1" }, session: null }, error: null };
const OK_SESSION = { data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null };

beforeEach(() => {
  signUp.mockReset().mockResolvedValue(OK_NO_SESSION);
  signInWithPassword.mockReset();
  rpc.mockReset();
  bootstrapOwnerWorkspace.mockReset();
});

describe("signUpLoyaltyMember — validation happens before any network call", () => {
  it("rejects a malformed email without calling signUp", async () => {
    for (const bad of ["", "nope", "no-at-sign.com", "trailing@"]) {
      const r = await signUpLoyaltyMember({ email: bad, password: "longenough1" });
      expect(r.ok, bad).toBe(false);
    }
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a short password without calling signUp", async () => {
    const r = await signUpLoyaltyMember({ email: "a@b.com", password: "short" });
    expect(r).toMatchObject({ ok: false });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("normalises the email before sending it", async () => {
    await signUpLoyaltyMember({ email: "  Person@Example.COM  ", password: "longenough1" });
    expect(signUp.mock.calls[0]![0]).toMatchObject({ email: "person@example.com" });
  });
});

describe("signUpLoyaltyMember — member intent and nothing else", () => {
  it("writes account_kind='member' and NO merchant metadata", async () => {
    await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    const opts = signUp.mock.calls[0]![0] as { options: { data: Record<string, unknown> } };

    expect(opts.options.data).toEqual({ account_kind: "member" });

    // Asserted as an exact key set rather than a spot-check: any future addition is a deliberate
    // decision, because a stray `pos_role`/`business_name` here is precisely what would turn a
    // loyalty signup into a shop owner.
    expect(Object.keys(opts.options.data).sort()).toEqual(["account_kind"]);
    for (const forbidden of ["pos_role", "business_name", "organization_name", "shop_display_name", "business_type"]) {
      expect(opts.options.data).not.toHaveProperty(forbidden);
    }
  });

  it("sends the member through the existing email callback URL", async () => {
    await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    const opts = signUp.mock.calls[0]![0] as { options: { emailRedirectTo: string } };
    // The same helper the merchant signup uses — no second callback implementation.
    expect(opts.options.emailRedirectTo).toBe("https://waka.ug/auth/callback");
  });
});

describe("signUpLoyaltyMember — outcomes", () => {
  it("reports that verification is needed when no session is returned", async () => {
    expect(await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" })).toEqual({
      ok: true,
      needsEmailVerification: true,
    });
  });

  it("reports an immediate session (verification disabled)", async () => {
    signUp.mockResolvedValue(OK_SESSION);
    expect(await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" })).toEqual({
      ok: true,
      needsEmailVerification: false,
    });
  });

  it("retries once on the transient Supabase signup failure, as the merchant path does", async () => {
    signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: "Database error saving new user" } });
    const r = await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    expect(signUp).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
  });

  it("handles an already-registered email safely", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "User already registered" } });
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login" } });
    const r = await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    expect(r.ok).toBe(false);
    // The message tells them what to do; it does not leak the raw auth error.
    expect(r.ok === false && r.error).toMatch(/sign in/i);
    expect(r.ok === false && r.error).not.toMatch(/already registered/i);
  });

  it("treats an existing account with the right password as a success", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "User already registered" } });
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" })).toEqual({
      ok: true,
      needsEmailVerification: false,
    });
  });

  it("surfaces a rate limit in terms the member can act on", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "email rate limit exceeded" } });
    const r = await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    expect(r.ok === false && r.error).toMatch(/wait a few minutes/i);
  });

  it("never leaks infrastructure detail to the member", async () => {
    signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "supabase jwt rpc failure" } });
    const r = await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    expect(r.ok === false && r.error).not.toMatch(/supabase|jwt|rpc/i);
  });

  it("survives a thrown transport error", async () => {
    signUp.mockRejectedValue(new Error("network down"));
    expect((await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" })).ok).toBe(false);
  });

  it("ignores a concurrent second submit while one is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    signUp.mockImplementation(() => new Promise((res) => (release = res)));
    const first = signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    const second = await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });
    expect(second.ok).toBe(false);
    expect(signUp).toHaveBeenCalledTimes(1);
    release(OK_NO_SESSION);
    await first;
  });
});

/**
 * THE regression test for this phase.
 *
 * A member signup must not be able to reach a merchant workspace through ANY path: not through the
 * signup itself, not through the metadata it writes, and not through the auth-state machinery that
 * runs afterwards. The bootstrap function is spied on directly, and the classification that all
 * bootstrap paths defer to is asserted to refuse.
 */
describe("SECURITY: a member signup cannot become a merchant workspace", () => {
  it("never calls bootstrapOwnerWorkspace, and the classifier refuses the state it creates", async () => {
    await signUpLoyaltyMember({ email: "a@b.com", password: "longenough1" });

    // 1. The signup itself performs no bootstrap and no RPC of any kind.
    expect(bootstrapOwnerWorkspace).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();

    // 2. The metadata it wrote cannot be read as merchant intent.
    const opts = signUp.mock.calls[0]![0] as { options: { data: Record<string, unknown> } };
    const { merchantIntentFromMetadata, memberIntentFromMetadata } = await import("./memberIdentity");
    expect(merchantIntentFromMetadata(opts.options.data)).toBe(false);
    expect(memberIntentFromMetadata(opts.options.data)).toBe(true);

    // 3. The state every bootstrap path defers to. Intent alone is NOT membership, so a fresh
    //    signup classifies as `unknown` — and `blocksOwnerBootstrap` is true for anything that is
    //    not a merchant. This is why `ensureWorkspaceForSession` and `ensureOwnerWorkspaceIfNeeded`
    //    both return without provisioning.
    const { resolveAccountIdentity, blocksOwnerBootstrap } = await import("./memberIdentity");
    const resolution = await resolveAccountIdentity({
      userId: "u-new",
      metadata: opts.options.data,
      force: true,
    });
    expect(resolution.kind).toBe("unknown");
    expect(blocksOwnerBootstrap(resolution)).toBe(true);
  });

  it("a member-intent user WITH a member row resolves to member, still not merchant", async () => {
    const { resolveAccountIdentity, blocksOwnerBootstrap } = await import("./memberIdentity");
    resetToMemberClassifier();
    const resolution = await resolveAccountIdentity({
      userId: "u-member",
      metadata: { account_kind: "member" },
      force: true,
    });
    expect(resolution.kind).toBe("member");
    expect(blocksOwnerBootstrap(resolution)).toBe(true);
  });
});

function resetToMemberClassifier() {
  rpc.mockResolvedValue({
    data: { ok: true, is_member: true, member_id: "m1", member_status: "active", member_intent: true },
    error: null,
  });
}
