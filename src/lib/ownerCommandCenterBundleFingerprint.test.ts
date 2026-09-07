import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { CashDrawerAdjustment, CashExpense, DayCloseSummary, Product, ReturnRecord, Sale } from "../types";
import { dayClosesForAuthority } from "./closedDayAuthority";
import { resolveDateFilterBounds } from "./dateFilters";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import type { OwnerCommandCenterInput } from "./ownerCommandCenter";
import {
  buildOwnerCommandCenterFingerprint,
  getCachedOwnerCommandCenterBundle,
} from "./ownerDashboardCommandCenter";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const DAY = "2026-09-06";
const BOUNDS = { fromKey: DAY, toKey: DAY, isSingleDay: true };

const product: Product = {
  id: "p1",
  name: "Item",
  sellingPricePerUnitUgx: 100_000,
  costPricePerUnitUgx: 40_000,
  stockOnHand: 50,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 5,
  updatedAt: `${DAY}T09:00:00.000Z`,
  version: 1,
};

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "createdAt" | "totalUgx">): Sale {
  return {
    updatedAt: partial.createdAt,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.totalUgx,
    debtUgx: 0,
    paymentMethod: "cash",
    estimatedProfitUgx: partial.totalUgx - 40_000,
    lines: [
      {
        productId: "p1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 40_000,
        lineTotalUgx: partial.totalUgx,
        estimatedProfitUgx: partial.totalUgx - 40_000,
        inputMode: "quantity",
        voided: false,
        updatedAt: partial.createdAt,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    status: "completed",
    ...partial,
  };
}

function ret(partial: Partial<ReturnRecord> & Pick<ReturnRecord, "id" | "saleId" | "refundAmountUgx">): ReturnRecord {
  return {
    productId: "p1",
    productName: "Item",
    quantity: 1,
    reason: "other",
    actorUserId: "owner",
    createdAt: `${DAY}T12:00:00.000Z`,
    ...partial,
  };
}

function closeFor(params: {
  id: string;
  dateKey: string;
  salesUgx: number;
  profitUgx?: number;
  expectedCashUgx?: number;
}): DayCloseSummary {
  const row = {
    id: params.id,
    dateKey: params.dateKey,
    expectedCashUgx: params.expectedCashUgx ?? params.salesUgx,
    countedCashUgx: params.expectedCashUgx ?? params.salesUgx,
    differenceUgx: 0,
    totalSalesUgx: params.salesUgx,
    totalDebtUgx: 0,
    profitEstimateUgx: params.profitUgx ?? Math.round(params.salesUgx * 0.4),
    openingFloatUgx: 0,
    createdAt: `${params.dateKey}T18:00:00.000Z`,
    closedByUserId: "owner",
    closedByLabel: "Owner",
  };
  return {
    ...row,
    documentSnapshot: buildDayCloseSnapshot({
      closedByUserId: "owner",
      closedByLabel: "Owner",
      row,
      drawer: {
        cashFromSalesUgx: params.salesUgx,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        openingFloatUgx: 0,
        cashSalesUgx: params.salesUgx,
        supplierPaymentsUgx: 0,
        adjustmentInflowsUgx: 0,
        adjustmentOutflowsUgx: 0,
        cashRefundsUgx: 0,
      },
      transactionCount: 1,
    }),
    supersededAt: null,
    pendingSync: false,
    updatedAt: `${params.dateKey}T18:00:00.000Z`,
  };
}

function expense(partial: Partial<CashExpense> & Pick<CashExpense, "id">): CashExpense {
  return {
    category: "transport",
    amountUgx: 5_000,
    description: "boda",
    paidOn: DAY,
    createdAt: `${DAY}T10:00:00.000Z`,
    createdByUserId: "owner",
    pendingSync: false,
    approvalStatus: "pending",
    deletedAt: null,
    ...partial,
  };
}

function adjustment(partial: Partial<CashDrawerAdjustment> & Pick<CashDrawerAdjustment, "id">): CashDrawerAdjustment {
  return {
    type: "owner_withdrawal",
    amountUgx: 20_000,
    note: "float",
    actorUserId: "owner",
    occurredAt: `${DAY}T11:00:00.000Z`,
    createdAt: `${DAY}T11:00:00.000Z`,
    updatedAt: `${DAY}T11:00:00.000Z`,
    pendingSync: false,
    deletedAt: null,
    ...partial,
  };
}

function input(extras?: Partial<OwnerCommandCenterInput>): OwnerCommandCenterInput {
  return {
    lang: "en",
    bounds: BOUNDS,
    sales: extras?.sales ?? [sale({ id: "s-main", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 100_000 })],
    products: [product],
    customers: [],
    suppliers: [],
    shifts: [],
    dayCloses: extras?.dayCloses ?? [],
    dayDrawerOpens: [],
    cashDrawerAdjustments: [],
    cashExpenses: [],
    debtPayments: [],
    stockMovements: [],
    inventoryCountSessions: [],
    auditLogs: [],
    voidRecords: extras?.voidRecords ?? [],
    returnRecords: extras?.returnRecords ?? [],
    purchases: [],
    supplierPayments: [],
    preferences: createDefaultPreferences(),
    acknowledgements: [],
    expectedCashUgx: extras?.expectedCashUgx ?? null,
    pharmacyMode: false,
    syncPendingCount: 0,
    syncErrorCount: 0,
    ...extras,
  };
}

describe("CC-P2-08 Owner Command Center bundle fingerprint / cache authority", () => {
  it("TEST 1 — unchanged inputs reuse the cached bundle", () => {
    const first = getCachedOwnerCommandCenterBundle(input());
    const second = getCachedOwnerCommandCenterBundle(input());
    expect(second).toBe(first);
    expect(buildOwnerCommandCenterFingerprint(input())).toBe(buildOwnerCommandCenterFingerprint(input()));
  });

  it("TEST 2 / 9 — middle sale mutation invalidates even when first/last IDs stay put", () => {
    const sales = [
      sale({ id: "s-a", createdAt: `${DAY}T09:00:00.000Z`, totalUgx: 10_000 }),
      sale({ id: "s-b", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 20_000 }),
      sale({ id: "s-c", createdAt: `${DAY}T11:00:00.000Z`, totalUgx: 30_000 }),
    ];
    const before = getCachedOwnerCommandCenterBundle(input({ sales }));
    const mutated = [
      sales[0]!,
      { ...sales[1]!, totalUgx: 80_000, updatedAt: `${DAY}T10:05:00.000Z`, estimatedProfitUgx: 40_000 },
      sales[2]!,
    ];
    expect(mutated.length).toBe(sales.length);
    expect(mutated[0]?.id).toBe(sales[0]?.id);
    expect(mutated[2]?.id).toBe(sales[2]?.id);
    expect(buildOwnerCommandCenterFingerprint(input({ sales: mutated }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ sales })),
    );
    const after = getCachedOwnerCommandCenterBundle(input({ sales: mutated }));
    expect(after).not.toBe(before);
    expect(after.overview.revenueUgx).toBe(120_000);
    expect(after.overview.revenueUgx).not.toBe(before.overview.revenueUgx);
  });

  it("TEST 3 — void metadata on the same sale array invalidates and drops revenue", () => {
    const open = sale({ id: "s-void", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 100_000 });
    const before = getCachedOwnerCommandCenterBundle(input({ sales: [open] }));
    expect(before.overview.revenueUgx).toBe(100_000);
    const voided: Sale = {
      ...open,
      saleVoidedAt: `${DAY}T11:00:00.000Z`,
      updatedAt: `${DAY}T11:00:00.000Z`,
    };
    expect(voided.id).toBe(open.id);
    const after = getCachedOwnerCommandCenterBundle(input({ sales: [voided] }));
    expect(after).not.toBe(before);
    expect(after.overview.revenueUgx).toBe(0);
  });

  it("TEST 4 — adding a linked return invalidates and reduces recognized revenue", () => {
    const saleRow = sale({ id: "s-ret", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 100_000 });
    const before = getCachedOwnerCommandCenterBundle(input({ sales: [saleRow], returnRecords: [] }));
    expect(before.overview.revenueUgx).toBe(100_000);
    const after = getCachedOwnerCommandCenterBundle(
      input({
        sales: [saleRow],
        returnRecords: [ret({ id: "r1", saleId: "s-ret", refundAmountUgx: 100_000 })],
      }),
    );
    expect(after).not.toBe(before);
    expect(after.overview.profitUgx).not.toBe(before.overview.profitUgx);
    expect(after.overview.profitUgx).toBeLessThan(before.overview.profitUgx);
    expect(saleRow.id).toBe("s-ret");
  });

  it("TEST 5 / 6 — same return count with changed content invalidates", () => {
    const saleRow = sale({ id: "s-ret2", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 100_000 });
    const r1 = ret({ id: "r-same", saleId: "s-ret2", refundAmountUgx: 20_000 });
    const before = getCachedOwnerCommandCenterBundle(input({ sales: [saleRow], returnRecords: [r1] }));
    const r2 = { ...r1, refundAmountUgx: 80_000 };
    expect([r2].length).toBe(1);
    const after = getCachedOwnerCommandCenterBundle(input({ sales: [saleRow], returnRecords: [r2] }));
    expect(buildOwnerCommandCenterFingerprint(input({ sales: [saleRow], returnRecords: [r2] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ sales: [saleRow], returnRecords: [r1] })),
    );
    expect(after).not.toBe(before);
    expect(after.overview.profitUgx).not.toBe(before.overview.profitUgx);
  });

  it("TEST 6 / 7 — DayClose financial content change invalidates with same length", () => {
    const saleRow = sale({ id: "s-close", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 250_000 });
    const closeA = closeFor({ id: "c1", dateKey: DAY, salesUgx: 80_000 });
    const before = getCachedOwnerCommandCenterBundle(input({ sales: [saleRow], dayCloses: [closeA] }));
    const closeB = { ...closeFor({ id: "c1", dateKey: DAY, salesUgx: 95_000 }), updatedAt: `${DAY}T19:00:00.000Z` };
    expect([closeB].length).toBe(1);
    expect(closeB.id).toBe(closeA.id);
    const after = getCachedOwnerCommandCenterBundle(input({ sales: [saleRow], dayCloses: [closeB] }));
    expect(after).not.toBe(before);
    expect(after.overview.revenueUgx).toBe(95_000);
    expect(after.overview.revenueUgx).not.toBe(before.overview.revenueUgx);
  });

  it("TEST 8 — archived close content in the authority list invalidates", () => {
    const saleRow = sale({
      id: "s-arch",
      createdAt: "2026-04-10T10:00:00.000Z",
      totalUgx: 200_000,
    });
    const bounds = { fromKey: "2026-04-10", toKey: "2026-04-10", isSingleDay: true };
    const archivedA = closeFor({ id: "arch-1", dateKey: "2026-04-10", salesUgx: 70_000 });
    const archivedB = { ...closeFor({ id: "arch-1", dateKey: "2026-04-10", salesUgx: 88_000 }), updatedAt: "2026-04-10T19:00:00.000Z" };
    const listA = dayClosesForAuthority([], [archivedA]);
    const listB = dayClosesForAuthority([], [archivedB]);
    const before = getCachedOwnerCommandCenterBundle(input({ bounds, sales: [saleRow], dayCloses: listA }));
    const after = getCachedOwnerCommandCenterBundle(input({ bounds, sales: [saleRow], dayCloses: listB }));
    expect(listA.length).toBe(listB.length);
    expect(after).not.toBe(before);
    expect(after.overview.revenueUgx).toBe(88_000);
  });

  it("TEST 10 — selected period change still busts the cache", () => {
    const today = getCachedOwnerCommandCenterBundle(input({ bounds: resolveDateFilterBounds({ kind: "preset", preset: "today" }) }));
    const yesterday = getCachedOwnerCommandCenterBundle(
      input({ bounds: resolveDateFilterBounds({ kind: "preset", preset: "yesterday" }) }),
    );
    expect(yesterday).not.toBe(today);
    expect(
      buildOwnerCommandCenterFingerprint(input({ bounds: resolveDateFilterBounds({ kind: "preset", preset: "today" }) })),
    ).not.toBe(
      buildOwnerCommandCenterFingerprint(
        input({ bounds: resolveDateFilterBounds({ kind: "preset", preset: "yesterday" }) }),
      ),
    );
  });

  it("TEST 11 — archived-only closed period uses the recomputed frozen headline after content change", () => {
    const bounds = { fromKey: "2026-04-10", toKey: "2026-04-10", isSingleDay: true };
    const saleRow = sale({ id: "s-arch-only", createdAt: "2026-04-10T10:00:00.000Z", totalUgx: 10_000 });
    const archived = closeFor({ id: "arch-only", dateKey: "2026-04-10", salesUgx: 60_000 });
    const bundle = getCachedOwnerCommandCenterBundle(
      input({ bounds, sales: [saleRow], dayCloses: dayClosesForAuthority([], [archived]) }),
    );
    expect(bundle.overview.revenueUgx).toBe(60_000);
  });

  it("TEST 12 — active + archived mixed period invalidates when the active close content changes", () => {
    const bounds = { fromKey: "2026-04-10", toKey: "2026-08-12", isSingleDay: false };
    const archived = closeFor({ id: "arch-m", dateKey: "2026-04-10", salesUgx: 40_000 });
    const activeA = closeFor({ id: "act-m", dateKey: "2026-08-12", salesUgx: 50_000 });
    const activeB = { ...closeFor({ id: "act-m", dateKey: "2026-08-12", salesUgx: 55_000 }), updatedAt: "2026-08-12T19:00:00.000Z" };
    const sales = [
      sale({ id: "s-m1", createdAt: "2026-04-10T10:00:00.000Z", totalUgx: 1_000 }),
      sale({ id: "s-m2", createdAt: "2026-08-12T10:00:00.000Z", totalUgx: 1_000 }),
    ];
    const before = getCachedOwnerCommandCenterBundle(
      input({ bounds, sales, dayCloses: dayClosesForAuthority([activeA], [archived]) }),
    );
    const after = getCachedOwnerCommandCenterBundle(
      input({ bounds, sales, dayCloses: dayClosesForAuthority([activeB], [archived]) }),
    );
    expect(after).not.toBe(before);
    expect(after.overview.revenueUgx).not.toBe(before.overview.revenueUgx);
  });

  it("TEST 13 — mixed closed + open period invalidates when the closed day snapshot changes", () => {
    const bounds = { fromKey: "2026-09-05", toKey: "2026-09-06", isSingleDay: false };
    const closedA = closeFor({ id: "mix-c", dateKey: "2026-09-05", salesUgx: 30_000 });
    const closedB = { ...closeFor({ id: "mix-c", dateKey: "2026-09-05", salesUgx: 45_000 }), updatedAt: "2026-09-05T19:00:00.000Z" };
    const sales = [
      sale({ id: "s-mix-c", createdAt: "2026-09-05T10:00:00.000Z", totalUgx: 1_000 }),
      sale({ id: "s-mix-o", createdAt: "2026-09-06T10:00:00.000Z", totalUgx: 20_000 }),
    ];
    const before = getCachedOwnerCommandCenterBundle(input({ bounds, sales, dayCloses: [closedA] }));
    const after = getCachedOwnerCommandCenterBundle(input({ bounds, sales, dayCloses: [closedB] }));
    expect(after).not.toBe(before);
    expect(after.overview.revenueUgx).not.toBe(before.overview.revenueUgx);
  });
});

describe("CC-P2-08 source wiring", () => {
  it("TEST 14 / 15 — permission and readiness presenters stay outside the fingerprint", () => {
    const page = src("src/pages/OwnerDashboardPage.tsx");
    expect(page).toContain("getCachedOwnerCommandCenterBundle");
    expect(page).toContain("resolveProfitVisibility");
    expect(page).toContain("resolveReportsFinancialReadiness");
    expect(page).toContain("presentCommandCenterOfficialFinancials");
    expect(page).toContain("useDayClosesForAuthority");

    const helper = src("src/lib/ownerDashboardCommandCenter.ts");
    expect(helper).toContain("salesMutationFingerprint");
    expect(helper).toContain("returnsMutationFingerprint");
    expect(helper).toContain("dayCloseMutationFingerprint");
    expect(helper).toContain("expensesMutationFingerprint");
    expect(helper).toContain("adjustmentsMutationFingerprint");
    expect(helper).toContain("productsMutationFingerprint");
    expect(helper).toContain('getCachedComputation("ownerCommandCenterBundle"');
    expect(helper).not.toContain("resolveProfitVisibility");
    expect(helper).not.toContain("overlayPeriodFinancials");

    const fingerprint = src("src/lib/computationResultCache.ts");
    expect(fingerprint).toContain("export function buildSalesFingerprint");
  });
});

describe("POST-AUDIT-06 Command Center expense / adjustment / product fingerprints", () => {
  it("TEST 1 — unchanged expense content keeps the same fingerprint", () => {
    const row = expense({ id: "e1", approvalStatus: "approved", amountUgx: 8_000 });
    expect(buildOwnerCommandCenterFingerprint(input({ cashExpenses: [row] }))).toBe(
      buildOwnerCommandCenterFingerprint(input({ cashExpenses: [{ ...row }] })),
    );
  });

  it("TEST 2 — expense approval status change invalidates with the same length", () => {
    const pending = expense({ id: "e1", approvalStatus: "pending", amountUgx: 8_000 });
    const approved = { ...pending, approvalStatus: "approved" as const };
    expect([approved].length).toBe(1);
    expect(buildOwnerCommandCenterFingerprint(input({ cashExpenses: [approved] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ cashExpenses: [pending] })),
    );
  });

  it("TEST 3 — expense void (deletedAt) invalidates with the same length", () => {
    const live = expense({ id: "e1", approvalStatus: "approved", deletedAt: null });
    const voided = { ...live, deletedAt: `${DAY}T15:00:00.000Z` };
    expect([voided].length).toBe(1);
    expect(buildOwnerCommandCenterFingerprint(input({ cashExpenses: [voided] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ cashExpenses: [live] })),
    );
  });

  it("TEST 4 — expense amount change invalidates", () => {
    const a = expense({ id: "e1", approvalStatus: "approved", amountUgx: 8_000 });
    const b = { ...a, amountUgx: 12_000 };
    expect(buildOwnerCommandCenterFingerprint(input({ cashExpenses: [b] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ cashExpenses: [a] })),
    );
  });

  it("TEST 5 — cash adjustment amount / void change invalidates", () => {
    const a = adjustment({ id: "adj-1", amountUgx: 20_000 });
    const amountChanged = { ...a, amountUgx: 30_000 };
    const voided = { ...a, deletedAt: `${DAY}T16:00:00.000Z` };
    expect([amountChanged].length).toBe(1);
    expect(buildOwnerCommandCenterFingerprint(input({ cashDrawerAdjustments: [amountChanged] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ cashDrawerAdjustments: [a] })),
    );
    expect(buildOwnerCommandCenterFingerprint(input({ cashDrawerAdjustments: [voided] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ cashDrawerAdjustments: [a] })),
    );
  });

  it("TEST 6 — product cost change invalidates", () => {
    const costly = { ...product, costPricePerUnitUgx: 12_000 };
    expect([costly].length).toBe(1);
    expect(buildOwnerCommandCenterFingerprint(input({ products: [costly] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ products: [product] })),
    );
  });

  it("TEST 7 — product stock change invalidates", () => {
    const lower = { ...product, stockOnHand: 5 };
    expect(buildOwnerCommandCenterFingerprint(input({ products: [lower] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ products: [product] })),
    );
  });

  it("TEST 8 — product identity replacement (archive/remove + same length) invalidates", () => {
    const replacement = { ...product, id: "p-archived-out" };
    expect([replacement].length).toBe(1);
    expect(buildOwnerCommandCenterFingerprint(input({ products: [replacement] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ products: [product] })),
    );
  });

  it("TEST 9 — irrelevant fields do not invalidate", () => {
    const expA = expense({ id: "e1", approvalStatus: "approved", description: "boda", pendingSync: false });
    const expB = { ...expA, description: "lunch", pendingSync: true };
    const adjA = adjustment({ id: "adj-1", note: "old", pendingSync: false });
    const adjB = { ...adjA, note: "new", pendingSync: true, actorName: "Other" };
    const prodB = { ...product, name: "Renamed", sku: "SKU-9", category: "Other", version: 9, updatedAt: `${DAY}T18:00:00.000Z` };
    expect(buildOwnerCommandCenterFingerprint(input({ cashExpenses: [expB] }))).toBe(
      buildOwnerCommandCenterFingerprint(input({ cashExpenses: [expA] })),
    );
    expect(buildOwnerCommandCenterFingerprint(input({ cashDrawerAdjustments: [adjB] }))).toBe(
      buildOwnerCommandCenterFingerprint(input({ cashDrawerAdjustments: [adjA] })),
    );
    expect(buildOwnerCommandCenterFingerprint(input({ products: [prodB] }))).toBe(
      buildOwnerCommandCenterFingerprint(input({ products: [product] })),
    );
  });

  it("TEST 10 — same-length collections with different relevant content differ", () => {
    const e1 = expense({ id: "e1", approvalStatus: "approved", amountUgx: 1_000 });
    const e2 = expense({ id: "e2", approvalStatus: "approved", amountUgx: 9_000 });
    expect([e1].length).toBe([e2].length);
    expect(buildOwnerCommandCenterFingerprint(input({ cashExpenses: [e2] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ cashExpenses: [e1] })),
    );
  });

  it("TEST 11 — repeated fingerprint of the same content is deterministic", () => {
    const payload = input({
      cashExpenses: [expense({ id: "e1", approvalStatus: "approved" })],
      cashDrawerAdjustments: [adjustment({ id: "adj-1" })],
      products: [product],
    });
    expect(buildOwnerCommandCenterFingerprint(payload)).toBe(buildOwnerCommandCenterFingerprint(payload));
    expect(buildOwnerCommandCenterFingerprint(payload)).toBe(buildOwnerCommandCenterFingerprint({ ...payload }));
  });

  it("TEST 12 — sales / returns / day-close fingerprints still invalidate independently", () => {
    const sales = [
      sale({ id: "s-a", createdAt: `${DAY}T09:00:00.000Z`, totalUgx: 10_000 }),
      sale({ id: "s-b", createdAt: `${DAY}T10:00:00.000Z`, totalUgx: 20_000 }),
    ];
    const mutatedSales = [sales[0]!, { ...sales[1]!, totalUgx: 50_000, estimatedProfitUgx: 10_000 }];
    expect(buildOwnerCommandCenterFingerprint(input({ sales: mutatedSales }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ sales })),
    );
    const r1 = ret({ id: "r-keep", saleId: "s-a", refundAmountUgx: 1_000 });
    const r2 = { ...r1, refundAmountUgx: 4_000 };
    expect(buildOwnerCommandCenterFingerprint(input({ sales, returnRecords: [r2] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ sales, returnRecords: [r1] })),
    );
    const closeA = closeFor({ id: "c-keep", dateKey: DAY, salesUgx: 10_000 });
    const closeB = { ...closeFor({ id: "c-keep", dateKey: DAY, salesUgx: 11_000 }), updatedAt: `${DAY}T19:00:00.000Z` };
    expect(buildOwnerCommandCenterFingerprint(input({ sales, dayCloses: [closeB] }))).not.toBe(
      buildOwnerCommandCenterFingerprint(input({ sales, dayCloses: [closeA] })),
    );
  });

  it("same length + approved expense recomputes the cached financial bundle", () => {
    const pending = expense({ id: "e-cache", approvalStatus: "pending", amountUgx: 8_000 });
    const before = getCachedOwnerCommandCenterBundle(input({ cashExpenses: [pending] }));
    expect(before.financial.expensesPeriodUgx).toBe(0);
    const approved = { ...pending, approvalStatus: "approved" as const };
    expect([approved].length).toBe([pending].length);
    const after = getCachedOwnerCommandCenterBundle(input({ cashExpenses: [approved] }));
    expect(after).not.toBe(before);
    expect(after.financial.expensesPeriodUgx).toBe(8_000);
  });

  it("same length + product cost edit recomputes inventory value", () => {
    const before = getCachedOwnerCommandCenterBundle(input({ products: [product] }));
    const costly = { ...product, costPricePerUnitUgx: 80_000 };
    expect([costly].length).toBe(1);
    const after = getCachedOwnerCommandCenterBundle(input({ products: [costly] }));
    expect(after).not.toBe(before);
    expect(after.inventory.inventoryValueUgx).not.toBe(before.inventory.inventoryValueUgx);
  });
});
