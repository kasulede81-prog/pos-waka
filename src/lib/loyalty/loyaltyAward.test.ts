import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3 — the POS may only claim points are banked once the SERVER's own
 * ledger row for that sale can be read back. Everything else is an estimate.
 */

type Row = { points: number; balance_after: number } | null;

let nextRow: Row = null;
let nextError: unknown = null;
let selectCalls: Array<Record<string, unknown>> = [];

vi.mock("../supabase", () => {
  const builder = () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: async () => {
        selectCalls.push({ ...filters });
        return { data: nextRow, error: nextError };
      },
    };
    return chain;
  };
  return {
    hasSupabaseConfig: true,
    supabase: { from: () => builder() },
  };
});

const { awaitConfirmedAward, fetchConfirmedAwardForSale } = await import("./loyaltyAward");

const SHOP = "aaaaaaaa-0000-4000-8000-000000000001";
const SALE = "bbbbbbbb-0000-4000-8000-000000000002";

describe("fetchConfirmedAwardForSale", () => {
  beforeEach(() => {
    nextRow = null;
    nextError = null;
    selectCalls = [];
  });

  it("returns the server's earned points and the balance it recorded", async () => {
    nextRow = { points: 25, balance_after: 1_350 };
    await expect(fetchConfirmedAwardForSale(SHOP, SALE)).resolves.toEqual({
      earnedPoints: 25,
      balancePoints: 1_350,
    });
  });

  it("scopes the read to this shop, this sale, and only the 'earned' row", async () => {
    nextRow = { points: 5, balance_after: 5 };
    await fetchConfirmedAwardForSale(SHOP, SALE);
    expect(selectCalls[0]).toEqual({
      shop_id: SHOP,
      source_sale_id: SALE,
      kind: "earned",
    });
  });

  it("returns null when the sale has not been awarded yet", async () => {
    nextRow = null;
    await expect(fetchConfirmedAwardForSale(SHOP, SALE)).resolves.toBeNull();
  });

  it("returns null on an error instead of throwing into checkout", async () => {
    nextError = { message: "offline" };
    await expect(fetchConfirmedAwardForSale(SHOP, SALE)).resolves.toBeNull();
  });

  it("treats a zero/negative award as nothing to show", async () => {
    nextRow = { points: 0, balance_after: 100 };
    await expect(fetchConfirmedAwardForSale(SHOP, SALE)).resolves.toBeNull();
  });

  it("needs both a shop and a sale before it will read anything", async () => {
    await expect(fetchConfirmedAwardForSale("", SALE)).resolves.toBeNull();
    await expect(fetchConfirmedAwardForSale(SHOP, "")).resolves.toBeNull();
    expect(selectCalls).toHaveLength(0);
  });
});

describe("awaitConfirmedAward", () => {
  beforeEach(() => {
    nextRow = null;
    nextError = null;
    selectCalls = [];
  });

  it("resolves as soon as the ledger row appears", async () => {
    let calls = 0;
    const original = globalThis.setTimeout;
    // Third poll finds it — simulates the sale finishing its sync.
    const poll = async () => {
      calls += 1;
      if (calls >= 3) nextRow = { points: 12, balance_after: 212 };
    };
    const promise = awaitConfirmedAward(SHOP, SALE, { attempts: 5, intervalMs: 1 });
    const interval = original(async function tick() {
      await poll();
      if (calls < 3) original(tick, 1);
    }, 1);
    expect(interval).toBeDefined();

    await expect(promise).resolves.toEqual({ earnedPoints: 12, balancePoints: 212 });
  });

  it("gives up quietly rather than claiming an award that never landed", async () => {
    await expect(
      awaitConfirmedAward(SHOP, SALE, { attempts: 2, intervalMs: 1 }),
    ).resolves.toBeNull();
  });

  it("stops early when the caller cancels (new sale started)", async () => {
    const signal = { cancelled: true };
    await expect(
      awaitConfirmedAward(SHOP, SALE, { attempts: 5, intervalMs: 1, signal }),
    ).resolves.toBeNull();
    expect(selectCalls).toHaveLength(0);
  });
});
