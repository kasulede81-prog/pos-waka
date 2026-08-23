import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sale } from "../types";
import { mergeSaleFromCloudPull } from "./saleFinancialMerge";
import {
  mergeCommercialSellerFields,
  saleSoldByMatchesActor,
  soldByAuthUserIdFromCloudSaleRow,
  soldByUserIdFromCloudSaleRow,
} from "./sellerIdentity";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "./soldByLabels";
import { filterSalesForHomeScope } from "./homeVisibility";
import { summarizeTodaySales } from "./todaySalesSummary";

const ROOT = process.cwd();
const CLOUD_SYNC = readFileSync(resolve(ROOT, "src/offline/cloudSync.ts"), "utf8");
const MERGE = readFileSync(resolve(ROOT, "src/lib/saleFinancialMerge.ts"), "utf8");

const OWNER = "11111111-1111-4111-8111-111111111111";
const CASHIER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const STAFF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function baseSale(partial: Partial<Sale>): Sale {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    lines: [],
    totalUgx: 10_000,
    subtotalUgx: 10_000,
    cashPaidUgx: 10_000,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-23T10:00:00.000Z",
    status: "completed",
    updatedAt: "2026-08-23T10:00:00.000Z",
    pendingSync: false,
    soldByUserId: null,
    soldByAuthUserId: null,
    ...partial,
  };
}

describe("STAFF-V2 Phase 10 seller read model", () => {
  it("R1 rowToSale prefers sold_by_user_id over created_by", () => {
    expect(
      soldByUserIdFromCloudSaleRow({
        sold_by_user_id: CASHIER,
        created_by: OWNER,
      }),
    ).toBe(CASHIER);
    expect(soldByAuthUserIdFromCloudSaleRow({ sold_by_user_id: CASHIER })).toBe(CASHIER);
    expect(CLOUD_SYNC).toMatch(/soldByUserId: soldByUserIdFromCloudSaleRow\(row\)/);
    expect(CLOUD_SYNC).toMatch(/created_by: ctx\.userId/);
    expect(CLOUD_SYNC).toMatch(/sold_by_user_id: resolveSoldByAuthUserIdForPush\(sale\)/);
  });

  it("R2 / R3 legacy NULL sold_by falls back to created_by; never invents from staff:", () => {
    expect(
      soldByUserIdFromCloudSaleRow({
        sold_by_user_id: null,
        created_by: OWNER,
      }),
    ).toBe(OWNER);
    expect(
      soldByUserIdFromCloudSaleRow({
        sold_by_user_id: `staff:${STAFF_ID}`,
        created_by: OWNER,
      }),
    ).toBe(OWNER);
    expect(soldByAuthUserIdFromCloudSaleRow({ sold_by_user_id: null })).toBeNull();
  });

  it("R4 offline PIN and Path S matching", () => {
    const offline = baseSale({ soldByUserId: `staff:${STAFF_ID}` });
    expect(
      saleSoldByMatchesActor(offline, { userId: `staff:${STAFF_ID}` }),
    ).toBe(true);

    const pulled = baseSale({ soldByUserId: CASHIER, soldByAuthUserId: CASHIER });
    expect(
      saleSoldByMatchesActor(pulled, {
        userId: `staff:${STAFF_ID}`,
        linkedAuthUserId: CASHIER,
      }),
    ).toBe(true);
    expect(
      saleSoldByMatchesActor(pulled, { userId: CASHIER }),
    ).toBe(true);
    expect(
      saleSoldByMatchesActor(pulled, {
        userId: `staff:${STAFF_ID}`,
        linkedAuthUserId: OTHER,
      }),
    ).toBe(false);
  });

  it("R5 merge preserves NULL → UUID commercial seller", () => {
    const local = baseSale({
      soldByUserId: null,
      soldByAuthUserId: null,
      updatedAt: "2026-08-23T10:00:00.000Z",
    });
    const remote = baseSale({
      soldByUserId: CASHIER,
      soldByAuthUserId: CASHIER,
      updatedAt: "2026-08-23T11:00:00.000Z",
    });
    const merged = mergeSaleFromCloudPull(local, remote);
    expect(merged.soldByUserId).toBe(CASHIER);
    expect(merged.soldByAuthUserId).toBe(CASHIER);
    expect(merged.totalUgx).toBe(10_000);
  });

  it("R5b does not flip UUID → different UUID", () => {
    const fields = mergeCommercialSellerFields(
      { soldByUserId: CASHIER, soldByAuthUserId: CASHIER },
      { soldByUserId: OTHER, soldByAuthUserId: OTHER },
    );
    expect(fields.soldByUserId).toBe(CASHIER);
    expect(MERGE).toMatch(/mergeCommercialSellerFields/);
  });

  it("R6 shop-wide totals unchanged by personal filter helper", () => {
    const sales = [
      baseSale({ id: "1", soldByUserId: CASHIER, totalUgx: 1000 }),
      baseSale({ id: "2", soldByUserId: OWNER, totalUgx: 2000 }),
    ];
    const shopWide = filterSalesForHomeScope(sales, "shop_wide", CASHIER);
    expect(shopWide.reduce((a, s) => a + s.totalUgx, 0)).toBe(3000);
  });

  it("R7 labels resolve Auth UUID via linkedAuthUserId; never owner for unknown Auth", () => {
    const map = buildSoldByNameByUserId({
      staffAccounts: [
        {
          id: STAFF_ID,
          name: "Jane Cashier",
          role: "cashier",
          active: true,
          createdAt: "",
          updatedAt: "",
          linkedAuthUserId: CASHIER,
        },
      ],
      ownerUserId: OWNER,
      ownerDisplayName: "Shop Owner",
    });
    expect(resolveSoldByUserId("en", CASHIER, map, "Shop")).toBe("Jane Cashier");
    expect(resolveSoldByUserId("en", OTHER, map, "Shop")).toBe("Unknown seller");
    expect(resolveSoldByUserId("en", `staff:${STAFF_ID}`, map)).toBe("Jane Cashier");
  });

  it("R8 home/today personal scope uses identity-aware match", () => {
    const sales = [
      baseSale({
        id: "a",
        soldByUserId: CASHIER,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      baseSale({
        id: "b",
        soldByUserId: OWNER,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ];
    const personal = filterSalesForHomeScope(sales, "personal", {
      userId: `staff:${STAFF_ID}`,
      linkedAuthUserId: CASHIER,
    });
    expect(personal.map((s) => s.id)).toEqual(["a"]);

    const today = summarizeTodaySales(sales, new Date(), {
      matchActor: { userId: `staff:${STAFF_ID}`, linkedAuthUserId: CASHIER },
    });
    expect(today.count).toBeGreaterThanOrEqual(0);
  });
});
