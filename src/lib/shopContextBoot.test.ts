import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHOP_INIT_RETRY_DELAYS_MS,
  resolveShopContextForBoot,
  type ShopContextBootDeps,
} from "./initializeActiveShop";
import type { ActiveShopState } from "../offline/shopScope";

/**
 * G3-A — the bounded retry around shop resolution.
 *
 * WHY THIS EXISTS AT ALL. Resolution is a network round trip, and it used to have exactly one
 * attempt and one caller: a single failure left the session with no shop for good, which is the
 * "sometimes it misbehaves, then refreshing fixes it" symptom. These tests pin the two properties
 * that make retrying safe — it retries ONLY an unresolved context (never a concluded one), and it
 * is bounded and cancellable (it can never outlive the boot that armed it).
 *
 * The helper takes its dependencies, so these drive the real policy without a network, a DOM, or
 * real timers.
 */
const ACCOUNT = "sb:user-1";

/** A scripted boot: each `initialize` call produces the next state, and the last one repeats. */
function bootHarness(states: ActiveShopState[]) {
  let state: ActiveShopState = "initializing";
  let accountKey: string | null = ACCOUNT;
  let current = true;
  let callIndex = 0;
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const waits: number[] = [];

  const deps: ShopContextBootDeps = {
    initialize: async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      state = states[Math.min(callIndex, states.length - 1)] ?? "initializing";
      callIndex += 1;
      inFlight -= 1;
      return state === "ready" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : null;
    },
    getState: () => state,
    getAccountKey: () => accountKey,
    isCurrent: () => current,
    // Resolves immediately: the schedule is asserted, not waited out.
    wait: async (ms) => {
      waits.push(ms);
    },
  };

  return {
    deps,
    setAccountKey: (next: string | null) => {
      accountKey = next;
    },
    setCurrent: (next: boolean) => {
      current = next;
    },
    stateNow: () => state,
    waits,
    calls: () => calls,
    maxInFlight: () => maxInFlight,
  };
}

function run(h: ReturnType<typeof bootHarness>) {
  return resolveShopContextForBoot(h.deps, { userId: "user-1", accountKey: ACCOUNT });
}

describe("G3-A — resolveShopContextForBoot", () => {
  it("succeeds on the first attempt without waiting", async () => {
    const h = bootHarness(["ready"]);

    const outcome = await run(h);

    expect(outcome).toEqual({ state: "ready", attempts: 1 });
    expect(h.waits).toEqual([]);
  });

  it("retries an unresolved context on the bounded schedule until it resolves", async () => {
    const h = bootHarness(["initializing", "initializing", "ready"]);

    const outcome = await run(h);

    expect(outcome.state).toBe("ready");
    expect(outcome.attempts).toBe(3);
    // The first two delays of the schedule, in order.
    expect(h.waits).toEqual([SHOP_INIT_RETRY_DELAYS_MS[0], SHOP_INIT_RETRY_DELAYS_MS[1]]);
  });

  it("is BOUNDED — it stops after one attempt plus the whole schedule and stays unresolved", async () => {
    const h = bootHarness(["initializing"]); // never resolves

    const outcome = await run(h);

    expect(outcome.state).toBe("initializing");
    expect(outcome.attempts).toBe(SHOP_INIT_RETRY_DELAYS_MS.length + 1);
    expect(h.calls()).toBe(SHOP_INIT_RETRY_DELAYS_MS.length + 1);
    // The whole delay schedule was used, and nothing beyond it.
    expect(h.waits).toEqual([...SHOP_INIT_RETRY_DELAYS_MS]);
    // Generous enough for a slow network, and finite.
    const totalWaitMs = h.waits.reduce((sum, ms) => sum + ms, 0);
    expect(totalWaitMs).toBeGreaterThanOrEqual(30_000);
    expect(totalWaitMs).toBeLessThanOrEqual(120_000);
  });

  it("never retries a CONCLUDED context — ready, no-shop, signed-out and not-required are answers", async () => {
    for (const concluded of ["ready", "no-shop", "signed-out", "not-required"] as const) {
      const h = bootHarness([concluded]);

      const outcome = await run(h);

      expect(outcome.state).toBe(concluded);
      expect(outcome.attempts).toBe(1);
      // A no-shop retry would re-ask an answered question; a signed-out retry would try to
      // resurrect a session that is gone.
      expect(h.waits).toEqual([]);
    }
  });

  it("never runs two resolution attempts at the same time", async () => {
    const h = bootHarness(["initializing", "initializing", "ready"]);

    await run(h);

    expect(h.maxInFlight()).toBe(1);
  });

  it("abandons the schedule as soon as the boot is superseded", async () => {
    const h = bootHarness(["initializing", "ready"]);
    const originalWait = h.deps.wait;
    h.deps.wait = async (ms) => {
      await originalWait(ms);
      h.setCurrent(false); // superseded while waiting — account change or unmount
    };

    const outcome = await run(h);

    expect(outcome.state).toBe("initializing");
    // No further attempt after the supersede, even though the script would have resolved on the
    // very next call. A superseded boot must not keep resolving — or keep a timer armed.
    expect(h.calls()).toBe(1);
    expect(h.waits).toEqual([SHOP_INIT_RETRY_DELAYS_MS[0]]);
  });

  it("does not continue a retry once the active account changed", async () => {
    const h = bootHarness(["initializing", "ready"]);
    const originalWait = h.deps.wait;
    h.deps.wait = async (ms) => {
      await originalWait(ms);
      h.setAccountKey("sb:user-2"); // a different account is now live
    };

    const outcome = await run(h);

    // A retry armed for one account must never resolve (or activate) another account's shop.
    expect(outcome.state).toBe("initializing");
    expect(h.calls()).toBe(1);
    expect(h.waits).toEqual([SHOP_INIT_RETRY_DELAYS_MS[0]]);
  });

  it("reports the context unresolved for a failure script, so no caller can read it as ready", async () => {
    const h = bootHarness(["initializing"]);

    const outcome = await run(h);

    expect(outcome.state).toBe("initializing");
    expect(outcome.state).not.toBe("ready");
    expect(h.stateNow()).toBe("initializing");
  });
});

/**
 * The provider's side of the gate.
 *
 * A STRUCTURAL CHECK, deliberately, and the one place in this file that is not behavioural: this
 * repo has no DOM test project (vitest runs `environment: "node"`), so `PosDataProvider`'s ready
 * gate cannot be rendered here. It pins the specific mistake the lifecycle exists to prevent —
 * collapsing "no shop YET" into "no shop AT ALL", which would block legitimate onboarding and
 * signed-out boots — by asserting the provider decides on the lifecycle state and never on the raw
 * id. The behavioural half (what each state means) is covered above and in
 * `initializeActiveShop.test.ts`.
 */
describe("G3-A — PosDataProvider gates on the lifecycle, not on a null id", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../providers/PosDataProvider.tsx"),
    "utf8",
  );

  /** Comments stripped, so an assertion about CODE is neither satisfied nor defeated by prose. */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("holds the boot in startup while the shop context is unresolved", () => {
    expect(code).toMatch(/shopBoot\.state === "initializing"/);
    expect(code).toContain("isShopContextUnresolved");
    expect(code).toContain("resolveShopContextForBoot");
  });

  it("never decides readiness from the raw shop id", () => {
    // `getActiveShopId()` returns null for "not resolved", "no shop" and "signed out" alike, so a
    // guard built on it is exactly the conflation this batch removes.
    expect(code).not.toContain("getActiveShopId");
    expect(code).not.toMatch(/if\s*\(\s*!getActiveShopId\(\)/);
  });
});
