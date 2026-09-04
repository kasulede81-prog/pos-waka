import { describe, expect, it } from "vitest";
import type { AuditLogEntry, Product, Sale, ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import { buildSaleReceiptContext } from "./receiptContextHelpers";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "./soldByLabels";
import { buildReceiptDisplayData } from "./receiptPrint";

const OWNER_UUID = "aaaaaaaa-1111-4111-8111-111111111111";
const UNKNOWN_UUID = "bbbbbbbb-2222-4222-8222-222222222222";
const JOHN_UUID = "cccccccc-3333-4333-8333-333333333333";

function sale(partial: Partial<Sale> = {}): Sale {
  return {
    id: "sale-p0",
    status: "completed",
    lines: [],
    subtotalUgx: 1_100,
    totalUgx: 1_100,
    cashPaidUgx: 10_000,
    debtUgx: 0,
    discountTotalUgx: 0,
    voidedTotalUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-09-04T14:01:00.000Z",
    updatedAt: "2026-09-04T14:01:00.000Z",
    pendingSync: false,
    lastSyncError: null,
    customerId: null,
    soldByUserId: OWNER_UUID,
    soldByAuthUserId: OWNER_UUID,
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
    ],
    shifts: [],
  } as unknown as ShopPreferences;
}

function ownerActor(): SessionActor {
  return {
    userId: OWNER_UUID,
    role: "owner",
    displayName: "Super Admin",
    authUserId: OWNER_UUID,
    authRole: "owner",
  };
}

function previewCashier(params: {
  soldByUserId: string | null | undefined;
  preferences: ShopPreferences;
  actor: SessionActor;
  auditLogs?: AuditLogEntry[];
}): string {
  const map = buildSoldByNameByUserId({
    staffAccounts: params.preferences.staffAccounts,
    shifts: params.preferences.shifts,
    auditLogs: params.auditLogs,
    ownerUserId: params.actor.authUserId ?? (params.actor.userId.startsWith("staff:") ? null : params.actor.userId),
    ownerDisplayName: params.actor.displayName,
    shopDisplayName: params.preferences.shopDisplayName,
  });
  return resolveSoldByUserId("en", params.soldByUserId, map, params.preferences.shopDisplayName);
}

describe("receipt P0 cashier identity", () => {
  it("resolves an owner Auth UUID to ownerDisplayName on the print path", () => {
    const completed = sale({ soldByUserId: OWNER_UUID });
    const ctx = buildSaleReceiptContext({
      lang: "en",
      sale: completed,
      allSales: [completed],
      preferences: prefs(),
      products: [] as Product[],
      actor: ownerActor(),
    });
    const display = buildReceiptDisplayData({
      shopName: ctx.shopName,
      cashier: ctx.cashier,
      receiptNumber: ctx.receiptNumber,
      sale: ctx.sale,
    });
    expect(ctx.cashier).toBe("Super Admin");
    expect(display.cashier).toBe("Super Admin");
    expect(ctx.cashier).not.toBe("Unknown seller");
  });

  it("resolves a known staff identity to the staff account name", () => {
    const completed = sale({ soldByUserId: "staff:john-staff-id", soldByAuthUserId: JOHN_UUID });
    const ctx = buildSaleReceiptContext({
      lang: "en",
      sale: completed,
      allSales: [completed],
      preferences: prefs(),
      products: [] as Product[],
      actor: ownerActor(),
    });
    expect(ctx.cashier).toBe("John");
  });

  it("keeps a genuinely unknown Auth UUID as Unknown seller", () => {
    const completed = sale({ soldByUserId: UNKNOWN_UUID, soldByAuthUserId: UNKNOWN_UUID });
    const ctx = buildSaleReceiptContext({
      lang: "en",
      sale: completed,
      allSales: [completed],
      preferences: prefs(),
      products: [] as Product[],
      actor: ownerActor(),
    });
    expect(ctx.cashier).toBe("Unknown seller");
  });

  it("matches preview cashier for the same sale and identity context", () => {
    const p = prefs();
    const actor = ownerActor();
    const auditLogs: AuditLogEntry[] = [];
    const completed = sale({ soldByUserId: OWNER_UUID });
    const preview = previewCashier({
      soldByUserId: completed.soldByUserId,
      preferences: p,
      actor,
      auditLogs,
    });
    const ctx = buildSaleReceiptContext({
      lang: "en",
      sale: completed,
      allSales: [completed],
      preferences: p,
      products: [] as Product[],
      actor,
      auditLogs,
    });
    expect(ctx.cashier).toBe(preview);
    expect(ctx.cashier).toBe("Super Admin");
  });
});
