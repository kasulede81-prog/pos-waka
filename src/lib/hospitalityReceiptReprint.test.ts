import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HospitalityFloorState, Sale, SaleLine, ShopPreferences } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  buildHospitalityReprintContext,
  isHospitalityBillSale,
} from "./hospitalityReceiptReprint";
import { buildRestaurantReceiptLines } from "./restaurantReceiptPrint";
import { buildRestaurantReceiptPdfBlob } from "./restaurantReceiptPdf";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function prefs(overrides: Partial<ShopPreferences> = {}): ShopPreferences {
  return {
    ...createDefaultPreferences(),
    businessType: "restaurant",
    hospitalityModeEnabled: true,
    shopDisplayName: "Waka Kitchen",
    ...overrides,
  };
}

function line(partial: Partial<SaleLine> = {}): SaleLine {
  return {
    id: "line-1",
    productId: "dish-1",
    name: "Chicken plate",
    inputMode: "quantity",
    quantity: 2,
    unitPriceUgx: 20_000,
    unitCostUgx: 8_000,
    lineTotalUgx: 40_000,
    estimatedProfitUgx: 24_000,
    ...partial,
  };
}

function tableSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "sale-table-1",
    status: "completed",
    tableSessionId: "session-1",
    referenceLabel: "Table 1 · Main",
    waiterName: "Amina",
    waiterStaffId: "staff:amina",
    lines: [line()],
    subtotalUgx: 40_000,
    discountTotalUgx: 0,
    serviceChargeUgx: 4_000,
    tipUgx: 0,
    taxUgx: 7_920,
    totalUgx: 51_920,
    cashPaidUgx: 51_920,
    debtUgx: 0,
    estimatedProfitUgx: 24_000,
    createdAt: "2026-10-17T12:00:00.000Z",
    pendingSync: false,
    soldByUserId: "staff:kasule",
    billDraft: {
      splitMode: "none",
      splits: [],
      payments: [{ id: "pay-1", method: "cash", amountUgx: 51_920 }],
      serviceChargePercent: 10,
      taxPercent: 18,
    },
    ...overrides,
  } as Sale;
}

const floor = {
  areas: [],
  tables: [{ id: "table-1", label: "Renamed table" }],
  sessions: [
    {
      id: "session-1",
      tableId: "table-1",
      saleId: "sale-table-1",
      guestCount: 4,
      status: "closed",
      openedAt: "2026-10-17T11:30:00.000Z",
      updatedAt: "2026-10-17T12:00:00.000Z",
    },
  ],
  stations: [],
} as unknown as HospitalityFloorState;

describe("Hospitality historical reprints", () => {
  it("identifies table/named Hospitality bills and leaves takeaway/retail alone", () => {
    expect(isHospitalityBillSale(tableSale())).toBe(true);
    expect(
      isHospitalityBillSale(
        tableSale({
          tableSessionId: null,
          referenceLabel: null,
          waiterName: null,
          waiterStaffId: null,
          billDraft: null,
          serviceChargeUgx: null,
          tipUgx: null,
          taxUgx: null,
        }),
      ),
    ).toBe(false);
  });

  it("uses persisted table/waiter context and the floor session's guest count", () => {
    const ctx = buildHospitalityReprintContext({
      sale: tableSale(),
      products: [],
      prefs: prefs(),
      lang: "en",
      floor,
      cashierLabel: "Kasule",
      printedBy: "Manager",
    });
    expect(ctx.tableLabel).toBe("Table 1 · Main");
    expect(ctx.waiterLabel).toBe("Amina");
    expect(ctx.guestCount).toBe(4);
    expect(ctx.cashierLabel).toBe("Kasule");
    expect(ctx.receiptKind).toBe("reprint");
    expect(ctx.reprint).toBe(true);
    expect(ctx.voidReceipt).toBe(false);

    const text = buildRestaurantReceiptLines(ctx).join("\n");
    expect(text).toContain("Table: Table 1 · Main");
    expect(text).toContain("Waiter: Amina");
    expect(text).toContain("Guests: 4");
    expect(text).toContain("Cashier: Kasule");
    expect(text).toMatch(/Service\s+UGX 4,000/);
    expect(text).toMatch(/Tax\s+UGX 7,920/);
    expect(text).toMatch(/TOTAL\s+UGX 51,920/);
  });

  it("never recalculates a settled bill from current service/tax settings", () => {
    const ctx = buildHospitalityReprintContext({
      sale: tableSale(),
      products: [],
      prefs: prefs({
        hospitalityServiceChargePercent: 25,
        hospitalityTaxEnabled: true,
        hospitalityTaxPercent: 25,
        hospitalityTaxMode: "inclusive",
      }),
      lang: "en",
    });
    const text = buildRestaurantReceiptLines(ctx).join("\n");
    expect(text).toContain("UGX 4,000");
    expect(text).toContain("UGX 7,920");
    expect(text).toContain("UGX 51,920");
    expect(text).not.toContain("UGX 12,500"); // 25% recalculated service
    expect(text).not.toContain("UGX 13,750"); // recomputed tax
  });

  it("omits missing table/waiter/service/tax context instead of inventing it", () => {
    const legacy = tableSale({
      referenceLabel: null,
      waiterName: null,
      waiterStaffId: null,
      serviceChargeUgx: null,
      tipUgx: null,
      taxUgx: null,
      billDraft: null,
    });
    const ctx = buildHospitalityReprintContext({
      sale: legacy,
      products: [],
      prefs: prefs({ hospitalityServiceChargePercent: 10, hospitalityTaxEnabled: true }),
      lang: "en",
    });
    expect(ctx.tableLabel).toBeNull();
    expect(ctx.waiterLabel).toBeNull();
    expect(ctx.guestCount).toBeNull();
    const text = buildRestaurantReceiptLines(ctx).join("\n");
    expect(text).not.toMatch(/\bTable:/);
    expect(text).not.toMatch(/\bWaiter:/);
    expect(text).not.toMatch(/\bGuests:/);
    expect(text).not.toMatch(/\bService\b/);
    expect(text).not.toMatch(/\bTax\b/);
    expect(text).toMatch(/TOTAL\s+UGX 51,920/);
  });

  it("prints a void reprint with the original recorded total", () => {
    const voided = tableSale({
      totalUgx: 0,
      voidedTotalUgx: 51_920,
      saleVoidedAt: "2026-10-17T13:00:00.000Z",
      saleVoidReason: "wrong table",
    });
    const ctx = buildHospitalityReprintContext({
      sale: voided,
      products: [],
      prefs: prefs(),
      lang: "en",
    });
    expect(ctx.receiptKind).toBe("void");
    expect(ctx.voidReceipt).toBe(true);
    const text = buildRestaurantReceiptLines(ctx).join("\n");
    expect(text).toContain("*** VOID ***");
    expect(text).toContain("wrong table");
    expect(text).toContain("UGX 51,920");
  });

  it("builds a PDF from the same restaurant lines", async () => {
    const ctx = buildHospitalityReprintContext({
      sale: tableSale(),
      products: [],
      prefs: prefs(),
      lang: "en",
      floor,
    });
    const blob = await buildRestaurantReceiptPdfBlob(ctx, "80mm");
    expect(blob.size).toBeGreaterThan(300);
    expect(src("src/lib/restaurantReceiptPdf.ts")).toContain("buildRestaurantReceiptLines");
  });

  it("routes only Hospitality bill sales to the restaurant reprint path", () => {
    const page = src("src/pages/ReceiptsPage.tsx");
    expect(page).toContain("if (isHospitalityBillSale(sale))");
    expect(page).toContain("printRestaurantReceiptForSale");
    expect(page).toContain("downloadRestaurantReceiptPdf");
    // The existing retail path is still the fallback.
    expect(page).toContain("printSaleReceipt(ctx)");
    expect(page).toContain("downloadSaleReceiptPdf(ctx)");
  });
});
