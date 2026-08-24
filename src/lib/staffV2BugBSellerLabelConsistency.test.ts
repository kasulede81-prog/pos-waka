import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sale, ShopPreferences, Product } from "../types";
import type { SessionActor } from "./sessionActor";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "./soldByLabels";
import { buildSaleReceiptContext } from "./receiptContextHelpers";

const ROOT = process.cwd();
const POS_PAGE = readFileSync(resolve(ROOT, "src/pages/PosPage.tsx"), "utf8");

const OWNER_UUID = "11111111-1111-4111-8111-111111111111";
const JOHN_UUID = "22222222-2222-4222-8222-222222222222";
const MARY_UUID = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_UUID = "44444444-4444-4444-8444-444444444444";

function sale(partial: Partial<Sale>): Sale {
  return {
    id: "sale-1",
    status: "completed",
    lines: [],
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 10_000,
    debtUgx: 0,
    discountTotalUgx: 0,
    voidedTotalUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
    soldByUserId: null,
    soldByAuthUserId: null,
    ...partial,
  };
}

function prefs(): ShopPreferences {
  return {
    businessType: "retail",
    stockMode: "quantity_only",
    lowStockThreshold: 5,
    localNetworkPasscodeHash: null,
    shopDisplayName: "Waka Shop",
    kioskQuickSell: false,
    onboardingDone: true,
    staffAccounts: [
      {
        id: "john-staff-id",
        name: "John",
        role: "cashier",
        active: true,
        createdAt: "",
        updatedAt: "",
        linkedAuthUserId: JOHN_UUID,
      },
      {
        id: "mary-staff-id",
        name: "Mary",
        role: "cashier",
        active: true,
        createdAt: "",
        updatedAt: "",
        linkedAuthUserId: MARY_UUID,
      },
    ],
  } as unknown as ShopPreferences;
}

function actorOwner(): SessionActor {
  return {
    userId: "staff:john-staff-id",
    role: "cashier",
    displayName: "Owner",
    authUserId: OWNER_UUID,
    authRole: "owner",
    linkedAuthUserId: JOHN_UUID,
    activeStaffId: "john-staff-id",
  };
}

describe("STAFF-V2 Bug B seller-label consistency", () => {
  it("S1 local staff id resolves to John", () => {
    const map = buildSoldByNameByUserId({ staffAccounts: prefs().staffAccounts, shopDisplayName: "Waka Shop" });
    expect(resolveSoldByUserId("en", "staff:john-staff-id", map, "Waka Shop")).toBe("John");
  });

  it("S2/S3 cloud-normalized uuid resolves to John, not Owner", () => {
    const p = prefs();
    const ctx = buildSaleReceiptContext({
      lang: "en",
      sale: sale({ soldByUserId: JOHN_UUID, soldByAuthUserId: JOHN_UUID }),
      allSales: [],
      preferences: p,
      products: [] as Product[],
      actor: actorOwner(),
    });
    expect(ctx.cashier).toBe("John");
    expect(ctx.cashier).not.toBe("Owner");
  });

  it("S4/S5 historical attribution remains tied to each sale identity", () => {
    const map = buildSoldByNameByUserId({ staffAccounts: prefs().staffAccounts, shopDisplayName: "Waka Shop" });
    expect(resolveSoldByUserId("en", JOHN_UUID, map, "Waka Shop")).toBe("John");
    expect(resolveSoldByUserId("en", MARY_UUID, map, "Waka Shop")).toBe("Mary");
  });

  it("S7 unresolved uuid stays neutral (never owner fallback)", () => {
    const map = buildSoldByNameByUserId({
      staffAccounts: prefs().staffAccounts,
      ownerUserId: OWNER_UUID,
      ownerDisplayName: "Owner",
      shopDisplayName: "Waka Shop",
    });
    expect(resolveSoldByUserId("en", UNKNOWN_UUID, map, "Waka Shop")).toBe("Unknown seller");
  });

  it("PosPage no longer falls back to actor.displayName", () => {
    expect(POS_PAGE).not.toMatch(/return actor\.displayName \?\? t\(lang, "role_owner"\)/);
    expect(POS_PAGE).toMatch(/resolveSoldByUserId\(lang, sale\.soldByUserId, soldByNameByUserId, preferences\.shopDisplayName\)/);
  });
});
