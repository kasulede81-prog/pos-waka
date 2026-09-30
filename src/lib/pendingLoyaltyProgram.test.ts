import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2C — the WPL code carried across an authentication round trip.
 *
 * The security property is not "it round-trips" but "it carries NOTHING ELSE". A shop id, account
 * id, organization id or member id in here would be client-controlled tenancy handed to the next
 * page; the code is a public merchant identifier and grants nothing on its own. Several of these
 * tests exist purely to keep it that way.
 */

/** Minimal in-memory Storage, since the vitest environment is `node` (no real Web Storage). */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

let local: Storage;
let session: Storage;

beforeEach(async () => {
  local = makeStorage();
  session = makeStorage();
  vi.stubGlobal("window", { localStorage: local, sessionStorage: session });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function mod() {
  vi.resetModules();
  return import("./pendingLoyaltyProgram");
}

describe("pending WPL context", () => {
  it("stores and reads a valid code, in both stores", async () => {
    const m = await mod();
    m.storePendingProgramCode("WPL2026001");
    expect(m.readPendingProgramCode()).toBe("WPL2026001");
    expect(local.getItem(m.PENDING_PROGRAM_KEY)).toBe("WPL2026001");
    expect(session.getItem(m.PENDING_PROGRAM_KEY)).toBe("WPL2026001");
  });

  it("normalises case and whitespace, so a typed code round-trips", async () => {
    const m = await mod();
    m.storePendingProgramCode("  wpl2026001 ");
    expect(m.readPendingProgramCode()).toBe("WPL2026001");
  });

  it("REFUSES to store anything that is not a valid code", async () => {
    const m = await mod();
    for (const bad of ["", "WPL", "WPL2026", "nonsense", "WPL2026001X", "2026001"]) {
      m.clearPendingProgramCode();
      m.storePendingProgramCode(bad);
      expect(m.readPendingProgramCode(), bad).toBeNull();
      expect(local.getItem(m.PENDING_PROGRAM_KEY), bad).toBeNull();
    }
  });

  it("re-validates on READ, so a tampered stored value never reaches navigation", async () => {
    const m = await mod();
    local.setItem(m.PENDING_PROGRAM_KEY, "<script>alert(1)</script>");
    session.setItem(m.PENDING_PROGRAM_KEY, "<script>alert(1)</script>");
    expect(m.readPendingProgramCode()).toBeNull();
  });

  it("consumes exactly once", async () => {
    const m = await mod();
    m.storePendingProgramCode("WPL2026002");
    expect(m.consumePendingProgramPath()).toBe("/j/WPL2026002");
    // A restore must not survive to influence a later sign-in.
    expect(m.consumePendingProgramPath()).toBeNull();
    expect(m.readPendingProgramCode()).toBeNull();
  });

  it("returns null when there is nothing pending", async () => {
    const m = await mod();
    expect(m.readPendingProgramCode()).toBeNull();
    expect(m.consumePendingProgramPath()).toBeNull();
  });

  it("writes ONLY the code — no id of any kind", async () => {
    const m = await mod();
    m.storePendingProgramCode("WPL2026001");

    // Exactly ONE entry in EACH store, and it is the code.
    expect(local.length).toBe(1);
    expect(session.length).toBe(1);
    expect(local.key(0)).toBe(m.PENDING_PROGRAM_KEY);
    expect(session.key(0)).toBe(m.PENDING_PROGRAM_KEY);

    const everything = `${local.key(0)}=${local.getItem(local.key(0)!)}|${session.key(0)}=${session.getItem(session.key(0)!)}`;
    for (const forbidden of [
      "shop_id",
      "shopId",
      "account_id",
      "accountId",
      "organization_id",
      "organizationId",
      "member_id",
      "memberId",
      "customer_id",
    ]) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
  });

  it("the module cannot express an id — its only writer takes one string", async () => {
    const src = readFileSync(join(process.cwd(), "src/lib/pendingLoyaltyProgram.ts"), "utf8");
    // The only writer takes exactly one string — the code. There is no second parameter through
    // which an id could ever be threaded in.
    expect(src).toMatch(/export function storePendingProgramCode\(code: string\): void/);

    // And no id-shaped identifier appears in the CODE. Comments are stripped first — the module's
    // own doc comment names these fields precisely to say it never stores them, and matching that
    // prose instead of the code would be testing the documentation.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(
      /shop_id|shopId|account_id|accountId|organization_id|organizationId|member_id|memberId|customer_id|customerId/,
    );
  });

  it("survives losing sessionStorage (a mobile browser killed the tab)", async () => {
    const m = await mod();
    m.storePendingProgramCode("WPL2026003");
    session.clear(); // only the durable copy remains
    expect(m.readPendingProgramCode()).toBe("WPL2026003");
  });

  it("degrades to null when storage is unavailable rather than throwing", async () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    const m = await mod();
    expect(() => m.storePendingProgramCode("WPL2026001")).not.toThrow();
    expect(m.readPendingProgramCode()).toBeNull();
    expect(() => m.clearPendingProgramCode()).not.toThrow();
  });
});

describe("the callback honours a pending join only on the loyalty host", () => {
  it("AuthCallbackPage restores the pending path", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/AuthCallbackPage.tsx"), "utf8");
    expect(src).toMatch(/consumePendingProgramPath|readPendingProgramCode/);
  });

  it("the restore is gated on the loyalty surface, so POS never consumes a loyalty join", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/AuthCallbackPage.tsx"), "utf8");
    // The call site — not the import — must be inside an isLoyaltySurface() ternary.
    const callSite = src.split("\n").find((l) => l.includes("consumePendingProgramPath()") && l.includes("isLoyaltySurface()"));
    expect(callSite, "the pending consume must be gated on the loyalty surface").toBeTruthy();
    expect(callSite).toMatch(/isLoyaltySurface\(\)\s*\?\s*consumePendingProgramPath\(\)\s*:\s*null/);
  });

  it("a pending join overrides the destination but never the bootstrap decision", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/AuthCallbackPage.tsx"), "utf8");
    // The bootstrap gate itself must remain untouched by the pending path. The condition must be
    // exactly this expression — no extra conjunct — and the provisioning call must be the FIRST
    // statement inside it.
    expect(src).toMatch(/const memberOnly = accountIdentity\.kind !== "merchant";/);
    // `(?:const \w+ = )?` tolerates the outcome being captured for the failure screen. It does
    // not weaken the assertion: the gate is still followed immediately by the bootstrap, and the
    // condition is still required to be exactly `!inviteGate.skipOwnerBootstrap && !memberOnly`.
    expect(src).toMatch(
      /if \(!inviteGate\.skipOwnerBootstrap && !memberOnly\) \{\s*\n\s*(?:const \w+ = )?await bootTraceAsync/,
    );
    // And the pending-join path is never part of that condition.
    expect(src).toMatch(/if \(!inviteGate\.skipOwnerBootstrap && !memberOnly\) \{/);
    expect(src).not.toMatch(/if \([^)]*pendingJoinPath[^)]*&&[^)]*!memberOnly/);
  });
});
