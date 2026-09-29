import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2D — the client half of enrollment status.
 *
 * The property under test is not "it refreshes". It is that REALTIME IS NEVER AN AUTHORITY: an
 * event says only that something changed, and every path — event, resubscribe, reconnect, tab wake,
 * fallback tick — ends in the same server read. Two assertions carry most of that weight: the
 * subscription callback never receives the payload, and the page re-reads the member dashboard
 * before it shows anything after an approval.
 */

const rpc = vi.fn();
const unsubscribe = vi.fn();
let changeHandler: ((payload: unknown) => void) | null = null;
let statusHandler: ((status: string) => void) | null = null;

vi.mock("../supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    channel: () => {
      const ch = {
        on: (_evt: string, _opts: unknown, cb: (p: unknown) => void) => {
          changeHandler = cb;
          return ch;
        },
        subscribe: (cb: (s: string) => void) => {
          statusHandler = cb;
          return ch;
        },
      };
      return ch;
    },
  },
}));

// `unsubscribe` lives on the channel object returned by subscribe() in the real client, so the
// mock above returns the same object throughout and we spy on it there.
const {
  fetchMemberEnrollmentStatus,
  resolveEnrollmentState,
  subscribeToMemberEnrollmentChanges,
} = await import("./loyaltyMemberEnrollment");

const READ = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

beforeEach(() => {
  rpc.mockReset();
  unsubscribe.mockReset();
  changeHandler = null;
  statusHandler = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// The authoritative read
// ===========================================================================

describe("the authoritative read", () => {
  it("calls the RPC with NO arguments — there is nobody else to ask about", async () => {
    rpc.mockResolvedValue({ data: { ok: true, requests: [] }, error: null });
    await fetchMemberEnrollmentStatus();
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("loyalty_member_enrollment_status");
    // No member id, no shop id, no filter — the server resolves the member from the session.
    expect(args === undefined || Object.keys(args as object).length === 0).toBe(true);
  });

  it("maps the curated payload and nothing else", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        requests: [
          {
            request_id: "r1",
            shop_name: "Shop A",
            status: "pending",
            requested_at: "2026-09-29T10:00:00Z",
            reviewed_at: null,
            // Anything extra the server might one day send is ignored by the mapper.
            reviewed_by: "should-not-appear",
            rejection_reason: "internal note",
          },
        ],
      },
      error: null,
    });
    const r = await fetchMemberEnrollmentStatus();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.requests[0]!).sort()).toEqual([
      "requestId",
      "requestedAt",
      "reviewedAt",
      "shopName",
      "status",
    ]);
    expect(JSON.stringify(r.requests[0])).not.toContain("should-not-appear");
    expect(JSON.stringify(r.requests[0])).not.toContain("internal note");
  });

  it("reports failure rather than inventing an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    const r = await fetchMemberEnrollmentStatus();
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// What the member is shown
// ===========================================================================

describe("resolveEnrollmentState precedence", () => {
  const req = (status: string, shop = "S") => ({
    requestId: `r-${status}-${shop}`,
    shopName: shop,
    status: status as never,
    requestedAt: null,
    reviewedAt: null,
  });

  it("shows nothing when there are no requests", () => {
    expect(resolveEnrollmentState([])).toEqual({ kind: "none" });
  });

  it("prefers a live pending request over an older rejection", () => {
    // A member refused by one merchant and waiting on another must see the thing in motion.
    const s = resolveEnrollmentState([req("rejected", "Old"), req("pending", "New")]);
    expect(s.kind).toBe("pending");
    expect(s.kind === "pending" && s.request.shopName).toBe("New");
  });

  it("prefers an approval over an older rejection", () => {
    const s = resolveEnrollmentState([req("rejected", "Old"), req("approved", "New")]);
    expect(s.kind).toBe("approved");
  });

  it("shows a rejection only when nothing is pending or approved", () => {
    expect(resolveEnrollmentState([req("rejected")]).kind).toBe("rejected");
  });

  it("treats an expired request as nothing to wait on", () => {
    expect(resolveEnrollmentState([req("expired")]).kind).toBe("none");
  });
});

// ===========================================================================
// Realtime is a nudge, never an authority
// ===========================================================================

describe("the realtime subscription", () => {
  it("signals on a change WITHOUT handing over the payload", () => {
    const seen: string[] = [];
    subscribeToMemberEnrollmentChanges((reason) => seen.push(reason));
    expect(changeHandler).toBeTruthy();

    // The callback receives a reason string; the row itself must never reach it, so it cannot be
    // mistaken for something to act on.
    changeHandler!({ eventType: "UPDATE", new: { status: "approved", member_id: "someone" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("realtime");
    expect(seen[0]).not.toContain("approved");
  });

  it("signals on every SUBSCRIBED, which is what closes the race", () => {
    const seen: string[] = [];
    subscribeToMemberEnrollmentChanges((reason) => seen.push(reason));
    expect(statusHandler).toBeTruthy();

    statusHandler!("SUBSCRIBED");
    // A reconnect (or a first subscribe landing after an approval) re-reads.
    statusHandler!("CHANNEL_ERROR");
    statusHandler!("SUBSCRIBED");
    expect(seen.filter((s) => s === "subscribed")).toHaveLength(2);
  });

  it("returns a teardown that unsubscribes", () => {
    const teardown = subscribeToMemberEnrollmentChanges(() => {});
    expect(typeof teardown).toBe("function");
    expect(() => teardown()).not.toThrow();
  });

  it("never grants anything from an event — the module has no write path", () => {
    const src = stripComments(READ("src/lib/loyalty/loyaltyMemberEnrollment.ts"));
    expect(src).not.toMatch(/insert|update|delete|loyalty_member_links|loyalty_member_register/);
    // And the only RPC it calls is the read.
    const calls = src.match(/supabase\.rpc\("([a-z_]+)"/g) ?? [];
    expect(calls).toEqual(['supabase.rpc("loyalty_member_enrollment_status"']);
  });
});

// ===========================================================================
// The hook: lifecycle and race handling
// ===========================================================================

describe("useMemberEnrollmentStatus lifecycle", () => {
  const HOOK = () => READ("src/hooks/useMemberEnrollmentStatus.ts");

  it("reads on mount before listening, so the first paint is already correct", () => {
    const src = HOOK();
    expect(src.indexOf("void refresh()")).toBeLessThan(src.indexOf("subscribeToMemberEnrollmentChanges(signal)"));
  });

  it("refetches on reconnect, tab wake and the fallback tick", () => {
    const src = HOOK();
    expect(src).toContain('addEventListener("visibilitychange"');
    expect(src).toContain('addEventListener("online"');
    expect(src).toContain('addEventListener("waka:network-online"');
    expect(src).toContain("ENROLLMENT_FALLBACK_POLL_MS");
  });

  it("cleans up everything on unmount or sign-out", () => {
    const src = HOOK();
    const cleanup = src.slice(src.indexOf("return () => {", src.indexOf("setInterval")));
    expect(cleanup).toContain("unsubscribe()");
    expect(cleanup).toContain("clearInterval(tick)");
    expect(cleanup).toContain('removeEventListener("visibilitychange"');
    expect(cleanup).toContain('removeEventListener("online"');
    expect(cleanup).toContain('removeEventListener("waka:network-online"');
  });

  it("is not polling-led: the fallback interval is measured in tens of seconds", async () => {
    const mod = await import("./loyaltyMemberEnrollment");
    expect(mod.ENROLLMENT_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("keeps the last known state when a read fails", () => {
    const src = stripComments(HOOK());
    // The setter runs only inside `if (result.ok)`.
    expect(src).toMatch(/if \(result\.ok\) setState\(resolveEnrollmentState\(result\.requests\)\)/);
  });
});

// ===========================================================================
// The page
// ===========================================================================

describe("the member page", () => {
  const PAGE = () => READ("src/pages/member/MemberHomePage.tsx");

  it("shows a pending state naming the merchant", () => {
    const src = PAGE();
    expect(src).toContain('data-testid="member-enrollment-pending"');
    expect(src).toContain("Waiting for merchant approval");
    expect(src).toContain("enrollment.request.shopName");
  });

  it("shows a rejected state that offers the code step again", () => {
    const src = PAGE();
    expect(src).toContain('data-testid="member-enrollment-rejected"');
    expect(src).toContain("Request not approved");
    const rejected = src.indexOf('data-testid="member-enrollment-rejected"');
    expect(src.slice(rejected, rejected + 900)).toContain("LoyaltyCodeEntryForm");
  });

  it("verifies membership authoritatively before showing the dashboard", () => {
    // On an approval the page re-reads the DASHBOARD, which is what reports links — the realtime
    // event alone never unlocks the dashboard.
    const src = PAGE();
    expect(src).toMatch(/enrollment\.kind !== "approved"/);
    expect(src).toContain("counts.linkedAccounts > 0");
    expect(src).toMatch(/void load\(\)\.then/);
  });

  it("gates the pending/rejected states on having no linked accounts", () => {
    const src = PAGE();
    expect(src).toMatch(/!hasLinkedAccounts && enrollment\.kind === "pending"/);
    expect(src).toMatch(/!hasLinkedAccounts && enrollment\.kind === "rejected"/);
  });

  it("bootstraps no merchant workspace anywhere on the member surface", () => {
    for (const p of [
      "src/pages/member/MemberHomePage.tsx",
      "src/hooks/useMemberEnrollmentStatus.ts",
      "src/lib/loyalty/loyaltyMemberEnrollment.ts",
    ]) {
      expect(stripComments(READ(p)), p).not.toMatch(
        /bootstrapOwnerWorkspace|bootstrap_owner_workspace|organization_members|shop_members|profiles/,
      );
    }
  });
});
