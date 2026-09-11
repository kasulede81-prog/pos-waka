/**
 * PHASE 1 — Excel product import + import safety hardening.
 *
 * These tests assert the whole point of the phase: an Excel workbook travels the
 * SAME pipeline as CSV and ends at `commitNewProducts` via `bulkQuickAddProducts`.
 * No second product/inventory system is introduced.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { usePosStore } from "../../store/usePosStore";
import { createDefaultPreferences } from "../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../storeSubscriptionContext";
import { subscriptionDiagnosticsRemoteFixture } from "../subscriptionDiagnostics";
import { buildProductFromSimpleWizard } from "../simpleProductWizard";
import { openingStockMovementFromProduct } from "../inventoryIntegrity";
import { commitNormalizedProductImport } from "./commitNormalizedProductImport";
import { evaluateNormalizedProductRows, summarizeImportReview } from "./evaluateNormalizedProductRows";
import { parseProductImportWorkbook } from "./parseProductImportExcel";
import { CSV_IMPORT_MAX_ROWS } from "./csvLimits";
import type { NormalizedProductImportRow } from "./types";

const PACK_HEADERS = [
  "Product Name",
  "Category",
  "Sell Unit",
  "Pack Type",
  "Units in Pack",
  "Buying Price per Pack (UGX)",
  "Selling Price per Unit (UGX)",
  "Opening Stock (Packs/Units)",
];

type PackRow = [string, string, string, string, number | string, number | string, number | string, number | string];

function workbookBytes(headers: readonly string[], rows: readonly (readonly unknown[])[]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([[...headers], ...rows.map((r) => [...r])]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function packRow(i: number, over: Partial<Record<number, unknown>> = {}): PackRow {
  const base: PackRow = [`Product ${i}`, "Groceries", "bottle", "carton", 24, 22000, 2000, 3];
  for (const [k, v] of Object.entries(over)) base[Number(k) as 0] = v as never;
  return base;
}

function seedStore(): void {
  setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
  usePosStore.setState({
    _hydrated: true,
    products: [],
    stockMovements: [],
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: {
      ...createDefaultPreferences(),
      businessType: "kiosk_duka",
      pharmacyModeEnabled: false,
    },
  });
}

/** Commit through the real store engine — the canonical path. */
function commitViaStore(rows: NormalizedProductImportRow[]) {
  return commitNormalizedProductImport({
    rows,
    pickerItems: [],
    bulkQuickAddProducts: usePosStore.getState().bulkQuickAddProducts,
  });
}

describe("PHASE 1 — Excel product import", () => {
  beforeEach(() => {
    seedStore();
  });

  it("TEST 1 — 500 valid rows import 500 products through commitNewProducts", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => packRow(i + 1));
    const parsed = await parseProductImportWorkbook(workbookBytes(PACK_HEADERS, rows));

    expect(parsed.ok).toBe(true);
    expect(parsed.rows).toHaveLength(500);
    expect(parsed.templateKind).toBe("with_packs");
    expect(parsed.rows.every((r) => r.source === "excel")).toBe(true);

    const result = commitViaStore(parsed.rows);
    expect(result.blocked).toBe(false);
    expect(result.added).toBe(500);
    expect(result.skipped).toBe(0);
    expect(usePosStore.getState().products).toHaveLength(500);
  });

  it("TEST 2 — pack configuration: 3 packs x 24 = 72 sell units", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3]]),
    );
    expect(parsed.ok).toBe(true);

    const row = parsed.rows[0]!;
    expect(row.packMode).toBe("packed");
    expect(row.conversionRate).toBe(24);
    expect(row.openingPacks).toBe(3);
    expect(row.stockQty).toBe(72);
    expect(row.buyingUnit).toBe("carton");
    expect(row.buyingPackCostUgx).toBe(22000);
    expect(row.costPricePerUnitUgx).toBeCloseTo(22000 / 24, 6);

    expect(commitViaStore(parsed.rows).added).toBe(1);
    const product = usePosStore.getState().products[0]!;
    expect(product.stockOnHand).toBe(72);
    expect(product.conversionRate).toBe(24);
    expect(product.buyingUnit).toBe("carton");
    expect(product.sellingPricePerUnitUgx).toBe(2000);
  });

  it("TEST 3 — missing buying price is a BLOCKING error with no invented cost", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, "", 2000, 3]]),
    );
    expect(parsed.ok).toBe(true);

    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.blocking).toBe(true);
    expect(evaluated[0]?.issues.some((i) => i.kind === "missing_cost_required" && i.severity === "error")).toBe(true);
    // No fallback cost is offered for Excel rows.
    expect(evaluated[0]?.fallbackCostUgx).toBeNull();
    expect(evaluated[0]?.issues.some((i) => i.kind === "cost_fallback")).toBe(false);

    const result = commitViaStore(parsed.rows);
    expect(result.blocked).toBe(true);
    expect(result.added).toBe(0);
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("TEST 4 — missing/invalid selling price is a BLOCKING error", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [
        ["No Price", "Groceries", "bottle", "carton", 24, 22000, "", 3],
        ["Bad Price", "Groceries", "bottle", "carton", 24, 22000, "abc", 3],
      ]),
    );
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated.every((e) => e.blocking)).toBe(true);
    expect(evaluated[0]?.issues.some((i) => i.kind === "invalid_price")).toBe(true);
    expect(commitViaStore(parsed.rows).blocked).toBe(true);
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("TEST 5 — units per pack = 0 is a BLOCKING error", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [["Zero Pack", "Groceries", "bottle", "carton", 0, 22000, 2000, 3]]),
    );
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.blocking).toBe(true);
    expect(evaluated[0]?.issues.some((i) => i.kind === "invalid_pack")).toBe(true);
    expect(commitViaStore(parsed.rows).blocked).toBe(true);
  });

  it("TEST 6 — 501 rows are rejected before any product is created", async () => {
    const rows = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => packRow(i + 1));
    const parsed = await parseProductImportWorkbook(workbookBytes(PACK_HEADERS, rows));

    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues.some((i) => i.kind === "too_many_rows")).toBe(true);
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("TEST 7 — duplicate names inside the file are a BLOCKING error", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [
        ["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3],
        ["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 5],
      ]),
    );
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated.every((e) => e.issues.some((i) => i.kind === "duplicate_name" && i.severity === "error"))).toBe(
      true,
    );
    expect(commitViaStore(parsed.rows).blocked).toBe(true);

    const summary = summarizeImportReview(evaluated);
    expect(summary.duplicateRows).toBe(2);
    expect(summary.errorRows).toBe(2);
    expect(summary.ready).toBe(0);
  });

  it("TEST 8 — an existing catalog product with the same name is a WARNING, not a block", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3]]),
    );
    const evaluated = evaluateNormalizedProductRows({
      rows: parsed.rows,
      pickerItems: [],
      existingProductNames: ["Pepsi 330ml"],
    });
    expect(evaluated[0]?.issues.some((i) => i.kind === "duplicate_existing" && i.severity === "warning")).toBe(true);
    expect(evaluated[0]?.blocking).toBe(false);
    expect(summarizeImportReview(evaluated).duplicateRows).toBe(1);
  });

  it("TEST 8b — DOCUMENTED current rule: inserted whitespace is NOT a duplicate", async () => {
    // `nameKey` collapses repeated whitespace and lowercases, so "PEPSI 330 ML"
    // and "Pepsi 330ml" are DIFFERENT keys. Documented, not silently changed.
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [
        ["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3],
        ["PEPSI 330 ML", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3],
      ]),
    );
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated.some((e) => e.issues.some((i) => i.kind === "duplicate_name"))).toBe(false);

    // Case-only differences ARE caught.
    const caseOnly = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [
        ["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3],
        ["PEPSI 330ML", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3],
      ]),
    );
    const caseEvaluated = evaluateNormalizedProductRows({ rows: caseOnly.rows, pickerItems: [] });
    expect(caseEvaluated.every((e) => e.issues.some((i) => i.kind === "duplicate_name"))).toBe(true);
  });

  it("TEST 9 — opening-stock movement IDs are deterministic across repeat imports", async () => {
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3]]),
    );
    expect(commitViaStore(parsed.rows).added).toBe(1);

    const product = usePosStore.getState().products[0]!;
    const movements = usePosStore
      .getState()
      .stockMovements.filter((m) => m.productId === product.id && m.kind === "opening_stock");
    expect(movements).toHaveLength(1);
    expect(movements[0]?.deltaBaseUnits).toBe(72);

    // Same shop + same product id always yields the same movement id, so a
    // replayed sync cannot create a second opening movement.
    const again = openingStockMovementFromProduct("shop-key", product, product.updatedAt);
    const twice = openingStockMovementFromProduct("shop-key", product, product.updatedAt);
    expect(again?.id).toBe(twice?.id);
    expect(again?.id).not.toBe(openingStockMovementFromProduct("other-shop", product, product.updatedAt)?.id);
  });

  it("TEST 10 — Excel product matches the manual wizard product for the same inputs", async () => {
    // Excel path
    const parsed = await parseProductImportWorkbook(
      workbookBytes(PACK_HEADERS, [["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3]]),
    );
    expect(commitViaStore(parsed.rows).added).toBe(1);
    const imported = usePosStore.getState().products[0]!;

    // Manual wizard path — the wizard emits the SAME draft shape the bulk engine
    // consumes, so committing it through `bulkQuickAddProducts` is the true
    // like-for-like comparison.
    const wizardDraft = buildProductFromSimpleWizard(
      {
        name: "Pepsi 330ml",
        shelf: "Soft Drinks",
        sellUnit: "bottle",
        sellUnitCustom: "",
        hasPack: true,
        packKind: "carton",
        packCustom: "",
        piecesPerPack: "24",
        stockCount: "3",
        sellPriceUgx: "2000",
        buyPackPriceUgx: "22000",
      },
      "en",
    )!;
    expect(wizardDraft).toBeTruthy();

    seedStore();
    const wizardResult = usePosStore.getState().bulkQuickAddProducts([wizardDraft]);
    expect(wizardResult.added).toBe(1);
    const manual = usePosStore.getState().products[0]!;

    // Same inputs must yield the same product fields.
    expect(imported.name).toBe(manual.name);
    expect(imported.category).toBe(manual.category);
    expect(imported.baseUnit).toBe(manual.baseUnit);
    expect(imported.sellingMode).toBe(manual.sellingMode);
    expect(imported.buyingUnit).toBe(manual.buyingUnit);
    expect(imported.conversionRate).toBe(manual.conversionRate);
    expect(imported.stockOnHand).toBe(manual.stockOnHand);
    expect(imported.stockOnHand).toBe(72);
    expect(imported.sellingPricePerUnitUgx).toBe(manual.sellingPricePerUnitUgx);
    expect(imported.costPricePerUnitUgx).toBeCloseTo(manual.costPricePerUnitUgx ?? 0, 6);
    expect(imported.buyingPackCostUgx).toBe(manual.buyingPackCostUgx);
  });
});

describe("PHASE 1 — plan limit reporting", () => {
  beforeEach(() => {
    seedStore();
  });

  it("TASK 7 — a plan cap reports added, skipped and the reason", async () => {
    setStoreSubscriptionContext({
      snapshot: subscriptionDiagnosticsRemoteFixture({ plan_code: "free", status: "active" }),
      authMode: "supabase",
    });

    const rows = Array.from({ length: 10 }, (_, i) => packRow(i + 1));
    const parsed = await parseProductImportWorkbook(workbookBytes(PACK_HEADERS, rows));
    expect(parsed.rows).toHaveLength(10);

    const result = commitViaStore(parsed.rows);
    expect(result.added).toBe(7); // FREE_PLAN_PRODUCT_LIMIT
    expect(result.skipped).toBe(3);
    expect(result.skippedReason).toBe("planProductLimit");
    expect(usePosStore.getState().products).toHaveLength(7);
  });
});

describe("PHASE 1 — Excel format coverage", () => {
  beforeEach(() => {
    seedStore();
  });

  it("reads .xlsx, .xls and .ods through the same pipeline", async () => {
    const aoa = [[...PACK_HEADERS], ["Pepsi 330ml", "Soft Drinks", "bottle", "carton", 24, 22000, 2000, 3]];
    for (const bookType of ["xlsx", "xls", "ods"] as const) {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Products");
      const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
      const parsed = await parseProductImportWorkbook(bytes);
      expect(parsed.ok, `${bookType} should parse`).toBe(true);
      expect(parsed.rows[0]?.stockQty, `${bookType} pack math`).toBe(72);
      expect(parsed.rows[0]?.source).toBe("excel");
    }
  });

  it("CSV keeps the existing cost-fallback warning (Excel rule does not leak)", async () => {
    const { parseProductImportCsv } = await import("./parseProductImportCsv");
    const csv =
      "Product name,Section,Unit,Pack,Pack size,Opening packs,Cost per pack,Selling price\n" +
      "Pepsi 330ml,Drinks,bottle,carton,24,3,,2000\n";
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.source).toBe("csv");

    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "cost_fallback" && i.severity === "warning")).toBe(true);
    expect(evaluated[0]?.issues.some((i) => i.kind === "missing_cost_required")).toBe(false);
    expect(evaluated[0]?.blocking).toBe(false);
  });
});
