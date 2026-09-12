/**
 * IMPORT-AUDIT-01 → IMPLEMENTATION PHASE — universal CSV/Excel product import.
 *
 * Covers: multi-sheet Excel detection (auto-select / picker / no-sheet-found),
 * expanded header aliases, mapping-confidence (ambiguous / generic / unsafe
 * pack-price), the 500-row limit applying to the SELECTED sheet only, pack
 * math, and CSV/Excel parity. Every scenario still ends at the existing
 * `commitNewProducts` engine via `bulkQuickAddProducts` — no second import
 * or product-creation path is introduced anywhere in this file.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { usePosStore } from "../../store/usePosStore";
import { createDefaultPreferences } from "../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../storeSubscriptionContext";
import { unitCostFromPackTotal } from "../costPrecision";
import { commitNormalizedProductImport } from "./commitNormalizedProductImport";
import { evaluateNormalizedProductRows, summarizeImportReview } from "./evaluateNormalizedProductRows";
import { analyzeHeaderMappings } from "./headerMappingConfidence";
import { csvImportFieldFromHeader, officialCsvImportHeadersNoPack, officialCsvImportHeadersWithPack } from "./csvColumns";
import { parseProductImportCsv } from "./parseProductImportCsv";
import { parseProductImportWorkbook } from "./parseProductImportExcel";
import { sellUnitsFromOpeningPacks, unitCostFromImportPackCost } from "./packImportSemantics";
import { CSV_IMPORT_MAX_ROWS } from "./csvLimits";
import type { NormalizedProductImportRow } from "./types";

function sheet(name: string, aoa: readonly (readonly unknown[])[]) {
  return { name, ws: XLSX.utils.aoa_to_sheet(aoa.map((r) => [...r])) };
}

function workbookBytesFromSheets(sheets: ReadonlyArray<{ name: string; ws: XLSX.WorkSheet }>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** A single-sheet workbook — unchanged pre-Phase-1 shape, used as a baseline. */
function singleSheetWorkbookBytes(headers: readonly string[], rows: readonly (readonly unknown[])[]): Uint8Array {
  return workbookBytesFromSheets([sheet("Products", [headers, ...rows])]);
}

const README_TEXT: readonly (readonly unknown[])[] = [
  ["WAKA Product Import Instructions"],
  ["Please fill in the Products sheet before uploading this file."],
  ["Do not edit column headers."],
];

const NO_PACK_HEADERS = ["Product Name", "Category", "Unit", "Quantity", "Purchase Price", "Retail Price"];
const WITH_PACK_HEADERS = [
  "Product Name",
  "Category",
  "Unit",
  "Buying Pack",
  "Units in Pack",
  "Opening Stock (packs)",
  "Cost per Pack",
  "Selling Price",
];

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

function commitViaStore(rows: NormalizedProductImportRow[]) {
  return commitNormalizedProductImport({
    rows,
    pickerItems: [],
    bulkQuickAddProducts: usePosStore.getState().bulkQuickAddProducts,
  });
}

describe("Multi-sheet Excel detection", () => {
  beforeEach(() => seedStore());

  it("1 — README-first XLSX: the Products sheet is automatically selected", async () => {
    const bytes = workbookBytesFromSheets([
      sheet("README", README_TEXT),
      sheet(
        "Products",
        [
          NO_PACK_HEADERS,
          ["Pepsi 330ml", "Soft Drinks", "bottle", 50, 1500, 2000],
          ["Sugar 1kg", "Groceries", "kg", 20, 2800, 3500],
        ],
      ),
    ]);

    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.sheetChoices).toBeUndefined();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.templateKind).toBe("no_packs");
    expect(parsed.rows[0]?.name).toBe("Pepsi 330ml");
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBe(1500);
    expect(parsed.rows[0]?.sellingPriceUgx).toBe(2000);

    const result = commitViaStore(parsed.rows);
    expect(result.added).toBe(2);
  });

  it("2 — two valid product sheets return sheet choices instead of guessing", async () => {
    const bytes = workbookBytesFromSheets([
      sheet("README", README_TEXT),
      sheet("Products", [NO_PACK_HEADERS, ["Sugar 1kg", "Groceries", "kg", 20, 2800, 3500]]),
      sheet("Packed Products", [WITH_PACK_HEADERS, ["Pepsi 330ml", "Drinks", "bottle", "crate", 24, 1, 18000, 2000]]),
    ]);

    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues.some((i) => i.kind === "multiple_sheets_found")).toBe(true);
    expect(parsed.sheetChoices?.map((c) => c.sheetName).sort()).toEqual(["Packed Products", "Products"]);
    // README must not be offered as a choice.
    expect(parsed.sheetChoices?.some((c) => c.sheetName === "README")).toBe(false);

    // The caller can now re-invoke with an explicit choice.
    const chosen = await parseProductImportWorkbook(bytes, { sheetName: "Packed Products" });
    expect(chosen.ok).toBe(true);
    expect(chosen.templateKind).toBe("with_packs");
    expect(chosen.rows[0]?.name).toBe("Pepsi 330ml");
  });

  it("3 — README + empty sheets only produces a clear no-product-sheet error", async () => {
    const bytes = workbookBytesFromSheets([
      sheet("README", README_TEXT),
      sheet("Notes", [["Nothing here yet."]]),
      sheet("Blank", []),
    ]);

    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.kind).toBe("no_product_sheet");
    expect(parsed.sheetChoices).toBeUndefined();
  });

  it("10 — README with 501 rows does not block a valid Products sheet", async () => {
    const readmeRows = Array.from({ length: 501 }, (_, i) => [`Instruction line ${i + 1}`]);
    const bytes = workbookBytesFromSheets([
      sheet("README", readmeRows),
      sheet("Products", [NO_PACK_HEADERS, ["Sugar 1kg", "Groceries", "kg", 20, 2800, 3500]]),
    ]);

    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.rows).toHaveLength(1);
    expect(commitViaStore(parsed.rows).added).toBe(1);
  });

  it("9 — the SELECTED sheet is still subject to the 500-row limit", async () => {
    const bigRows = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => [
      `Product ${i}`,
      "Groceries",
      "piece",
      1,
      1000,
      1500,
    ]);
    const bytes = workbookBytesFromSheets([
      sheet("README", README_TEXT),
      sheet("Products", [NO_PACK_HEADERS, ...bigRows]),
    ]);

    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.some((i) => i.kind === "too_many_rows")).toBe(true);
  });
});

describe("Expanded header aliases (additive, Phase 3)", () => {
  beforeEach(() => seedStore());

  it("4 — Description / Department / Qty / Purchase Price / Retail Price all resolve", () => {
    expect(csvImportFieldFromHeader("Description")).toBe("name");
    expect(csvImportFieldFromHeader("Department")).toBe("section");
    expect(csvImportFieldFromHeader("Group")).toBe("section");
    expect(csvImportFieldFromHeader("Qty")).toBe("openingQty");
    expect(csvImportFieldFromHeader("Purchase Price")).toBe("costPrice");
    expect(csvImportFieldFromHeader("Cost per Unit")).toBe("costPrice");
    expect(csvImportFieldFromHeader("Retail Price")).toBe("sellingPrice");
    expect(csvImportFieldFromHeader("Buying Pack")).toBe("packLabel");
    expect(csvImportFieldFromHeader("Package")).toBe("packLabel");
    expect(csvImportFieldFromHeader("Qty per Pack")).toBe("packSize");
    expect(csvImportFieldFromHeader("Purchase Price per Pack")).toBe("costPerPack");

    // And every existing WAKA-template header still resolves (Phase 3 is additive).
    for (const h of officialCsvImportHeadersNoPack()) expect(csvImportFieldFromHeader(h)).not.toBeNull();
    for (const h of officialCsvImportHeadersWithPack()) expect(csvImportFieldFromHeader(h)).not.toBeNull();
  });

  it("4b — a normal spreadsheet using only the new aliases imports end to end", async () => {
    const csv = [
      "Description,Department,Unit,Qty,Purchase Price,Retail Price",
      "Pepsi 330ml,Soft Drinks,bottle,50,1500,2000",
    ].join("\n");
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.templateKind).toBe("no_packs");
    expect(parsed.rows[0]?.name).toBe("Pepsi 330ml");
    expect(parsed.rows[0]?.category).toBe("");
    expect(parsed.rows[0]?.categoryInput).toBe("Soft Drinks");
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBe(1500);
    expect(parsed.rows[0]?.sellingPriceUgx).toBe(2000);

    expect(commitViaStore(parsed.rows).added).toBe(1);
  });
});

describe("Mapping confidence (Phase 4/6/7)", () => {
  beforeEach(() => seedStore());

  it("high confidence: an exact, unambiguous WAKA header", () => {
    const decisions = analyzeHeaderMappings(officialCsvImportHeadersNoPack());
    expect(decisions.every((d) => d.confidence === "high")).toBe(true);
  });

  it("medium confidence: a bare generic term ('Price' / 'Cost')", () => {
    const decisions = analyzeHeaderMappings(["Product name", "Qty", "Cost", "Price"]);
    const cost = decisions.find((d) => d.sourceHeader === "Cost");
    const price = decisions.find((d) => d.sourceHeader === "Price");
    expect(cost).toMatchObject({ canonicalField: "costPrice", confidence: "medium", reason: "generic_term" });
    expect(price).toMatchObject({ canonicalField: "sellingPrice", confidence: "medium", reason: "generic_term" });
  });

  it("5 — competing columns for the same field are reported, not silently discarded", () => {
    const header = ["Product Name", "Qty", "Cost", "Price", "Retail Price"];
    const decisions = analyzeHeaderMappings(header);
    const competing = decisions.filter((d) => d.reason === "competing_columns");
    // Both "Price" and "Retail Price" map to sellingPrice — both must be
    // reported (neither is silently dropped from the analysis).
    expect(competing.map((d) => d.sourceHeader).sort()).toEqual(["Price", "Retail Price"]);
    expect(competing.every((d) => d.confidence === "medium")).toBe(true);

    // The underlying row-building mapping (mapCsvImportHeaderRow, via the
    // CSV parser) is unaffected — it still deterministically picks the first
    // occurrence; the analyzer only adds a warning on top of that.
    const csv = ["Product Name,Section,Unit,Qty,Cost,Price,Retail Price", "Sugar,Groceries,kg,10,2800,3500,9999"].join(
      "\n",
    );
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.rows[0]?.sellingPriceUgx).toBe(3500); // "Price" — the first column, unchanged behaviour.

    const evaluated = evaluateNormalizedProductRows({
      rows: parsed.rows,
      pickerItems: [],
      headerMappings: parsed.headerMappings,
    });
    expect(evaluated[0]?.issues.some((i) => i.kind === "mapping_ambiguous" && i.severity === "warning")).toBe(true);
    expect(evaluated[0]?.blocking).toBe(false); // warning only — does not block.
  });

  it("6 — 'Selling Price per Carton' is never silently treated as a unit price", async () => {
    // The exact alias table never matches this compound header at all.
    expect(csvImportFieldFromHeader("Selling Price per Carton")).toBeNull();
    expect(csvImportFieldFromHeader("Cost per Box")).toBeNull();

    // The analyzer explains WHY: it recognizes the price/pack intent without
    // ever letting it resolve to a canonical unit-price field.
    const decisions = analyzeHeaderMappings(["Product Name", "Qty", "Cost", "Selling Price per Carton"]);
    const flagged = decisions.find((d) => d.sourceHeader === "Selling Price per Carton");
    expect(flagged).toMatchObject({ canonicalField: null, confidence: "low", reason: "pack_price_conflict" });

    // End to end: because "Selling Price per Carton" is the ONLY price-shaped
    // column and it is not trusted as sellingPrice, this sheet has no working
    // selling-price column at all. That fails template detection outright —
    // the strongest possible guarantee: zero rows are ever produced, so the
    // value can never reach a product, let alone become a unit price.
    const csv = ["Product Name,Section,Unit,Qty,Cost,Selling Price per Carton", "Pepsi,Drinks,bottle,50,1500,48000"].join(
      "\n",
    );
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues.some((i) => i.kind === "unrecognized_template")).toBe(true);

    expect(commitViaStore(parsed.rows).blocked).toBe(true);
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("6b — a safe selling-price column alongside an unsafe one is NOT blocked", () => {
    // "Selling Price" (safe, HIGH) plus "Selling Price per Carton" (unsafe,
    // ignored) — the safe column still feeds the row; the conflict is
    // informational only because nothing is actually missing.
    const csv = [
      "Product Name,Section,Unit,Qty,Cost,Selling Price,Selling Price per Carton",
      "Pepsi,Drinks,bottle,50,1500,2000,48000",
    ].join("\n");
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.rows[0]?.sellingPriceUgx).toBe(2000);

    const evaluated = evaluateNormalizedProductRows({
      rows: parsed.rows,
      pickerItems: [],
      headerMappings: parsed.headerMappings,
    });
    expect(evaluated[0]?.blocking).toBe(false);
  });
});

describe("Existing WAKA templates are unaffected (Phase 7/8/9 regression guard)", () => {
  beforeEach(() => seedStore());

  it("7 — WAKA No Packs template behaves exactly as before", () => {
    const csv = [officialCsvImportHeadersNoPack().join(","), "Sugar 1kg,Groceries,kg,10,2800,3500"].join("\n");
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok).toBe(true);
    expect(parsed.templateKind).toBe("no_packs");
    expect(parsed.rows[0]?.packMode).toBe("none");
    expect(parsed.rows[0]?.stockQty).toBe(10);
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBe(2800);
    expect(parsed.rows[0]?.sellingPriceUgx).toBe(3500);
    // No new mapping issues on a fully-official header.
    const evaluated = evaluateNormalizedProductRows({
      rows: parsed.rows,
      pickerItems: [],
      headerMappings: parsed.headerMappings,
    });
    expect(evaluated[0]?.issues.filter((i) => i.kind.startsWith("mapping_"))).toHaveLength(0);
    expect(commitViaStore(parsed.rows).added).toBe(1);
  });

  it("8 — WAKA With Packs template behaves exactly as before", () => {
    const csv = [
      officialCsvImportHeadersWithPack().join(","),
      "Coca Cola 500ml,Drinks,bottle,crate,24,1,18000,2000",
    ].join("\n");
    const parsed = parseProductImportCsv(csv);
    expect(parsed.ok).toBe(true);
    expect(parsed.templateKind).toBe("with_packs");
    expect(parsed.rows[0]?.packMode).toBe("packed");
    expect(parsed.rows[0]?.stockQty).toBe(24); // 1 pack x 24
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBeCloseTo(750, 6);
    const evaluated = evaluateNormalizedProductRows({
      rows: parsed.rows,
      pickerItems: [],
      headerMappings: parsed.headerMappings,
    });
    expect(evaluated[0]?.issues.filter((i) => i.kind.startsWith("mapping_"))).toHaveLength(0);
    expect(commitViaStore(parsed.rows).added).toBe(1);
  });
});

describe("Pack math is unchanged (Phase 5/11) — reused, never duplicated", () => {
  it("11 — 48 packs x 24 units/pack = 1,152; 18,000 / 24 = 750", () => {
    expect(sellUnitsFromOpeningPacks(48, 24)).toBe(1152);
    expect(unitCostFromImportPackCost(18000, 24)).toBe(750);
    expect(unitCostFromPackTotal(18000, 24)).toBe(750);
  });

  it("11b — full Coca Cola example end to end via Excel", async () => {
    const bytes = singleSheetWorkbookBytes(WITH_PACK_HEADERS, [
      ["Coca Cola 500ml", "Drinks", "bottle", "crate", 24, 1, 18000, 2000],
    ]);
    // Note: this workbook header set uses "Buying Pack"/"Units in Pack"/
    // "Cost per Pack" — the NEW aliases — proving Phase 3 and Phase 5 compose.
    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.rows[0]?.stockQty).toBe(24);
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBeCloseTo(750, 6);
  });
});

describe("CSV and Excel parity (Phase 12)", () => {
  beforeEach(() => seedStore());

  it("12 — the same product via CSV and XLSX normalizes identically", async () => {
    const csv = [
      "Product Name,Category,Unit,Buying Pack,Units in Pack,Opening Stock (packs),Cost per Pack,Selling Price",
      "Coca Cola 500ml,Drinks,bottle,crate,24,1,18000,2000",
    ].join("\n");
    const csvParsed = parseProductImportCsv(csv);
    expect(csvParsed.ok, JSON.stringify(csvParsed.issues)).toBe(true);

    const xlsxParsed = await parseProductImportWorkbook(
      singleSheetWorkbookBytes(
        WITH_PACK_HEADERS,
        [["Coca Cola 500ml", "Drinks", "bottle", "crate", 24, 1, 18000, 2000]],
      ),
    );
    expect(xlsxParsed.ok, JSON.stringify(xlsxParsed.issues)).toBe(true);

    const c = csvParsed.rows[0]!;
    const x = xlsxParsed.rows[0]!;
    expect(x.name).toBe(c.name);
    expect(x.categoryInput).toBe(c.categoryInput);
    expect(x.baseUnit).toBe(c.baseUnit);
    expect(x.packMode).toBe(c.packMode);
    expect(x.buyingUnit).toBe(c.buyingUnit);
    expect(x.conversionRate).toBe(c.conversionRate);
    expect(x.stockQty).toBe(c.stockQty);
    expect(x.sellingPriceUgx).toBe(c.sellingPriceUgx);
    expect(x.costPricePerUnitUgx).toBeCloseTo(c.costPricePerUnitUgx ?? 0, 6);
    expect(x.buyingPackCostUgx).toBe(c.buyingPackCostUgx);
    // Only provenance differs.
    expect(c.source).toBe("csv");
    expect(x.source).toBe("excel");

    // And they commit to identical products through the one shared engine.
    const csvResult = commitViaStore(csvParsed.rows);
    expect(csvResult.added).toBe(1);
    const csvProduct = usePosStore.getState().products[0]!;

    seedStore();
    const xlsxResult = commitViaStore(xlsxParsed.rows);
    expect(xlsxResult.added).toBe(1);
    const xlsxProduct = usePosStore.getState().products[0]!;

    expect(xlsxProduct.name).toBe(csvProduct.name);
    expect(xlsxProduct.stockOnHand).toBe(csvProduct.stockOnHand);
    expect(xlsxProduct.conversionRate).toBe(csvProduct.conversionRate);
    expect(xlsxProduct.sellingPricePerUnitUgx).toBe(csvProduct.sellingPricePerUnitUgx);
    expect(xlsxProduct.costPricePerUnitUgx).toBeCloseTo(csvProduct.costPricePerUnitUgx ?? 0, 6);
  });
});

describe("Backward compatibility: existing callers that omit headerMappings", () => {
  it("evaluateNormalizedProductRows behaves identically with no headerMappings argument", () => {
    const rows: NormalizedProductImportRow[] = [
      {
        clientId: "c1",
        source: "manual",
        enabled: true,
        name: "Soap",
        categoryInput: "",
        category: "General",
        baseUnit: "piece",
        packMode: "none",
        stockQty: 5,
        sellingPriceUgx: 2000,
        costPricePerUnitUgx: 900,
      },
    ];
    const withoutMappings = evaluateNormalizedProductRows({ rows, pickerItems: [] });
    const withEmptyMappings = evaluateNormalizedProductRows({ rows, pickerItems: [], headerMappings: [] });
    expect(withoutMappings[0]?.issues.filter((i) => i.kind.startsWith("mapping_"))).toHaveLength(0);
    expect(withEmptyMappings[0]?.issues.filter((i) => i.kind.startsWith("mapping_"))).toHaveLength(0);
    expect(withoutMappings[0]?.blocking).toBe(false);
  });
});

describe("Review summary stays additive", () => {
  beforeEach(() => seedStore());

  /**
   * In a real parse, a sheet whose ONLY price column is pack-conflicted fails
   * template detection before any row exists (see test 6) — the strongest
   * guarantee. This test exercises the `mapping_pack_price_conflict` row-level
   * check directly, in case a future alias change ever lets such a header
   * through template detection with a price that still ends up missing.
   */
  it("summarizeImportReview counts a pack-price-conflict-with-missing-price row as an error, not ready", () => {
    const rows: NormalizedProductImportRow[] = [
      {
        clientId: "c1",
        source: "csv",
        enabled: true,
        name: "Pepsi 330ml",
        categoryInput: "Drinks",
        category: "Drinks",
        baseUnit: "bottle",
        packMode: "none",
        stockQty: 50,
        sellingPriceUgx: 0,
        costPricePerUnitUgx: 1500,
      },
    ];
    const evaluated = evaluateNormalizedProductRows({
      rows,
      pickerItems: [],
      headerMappings: [
        { sourceHeader: "Selling Price per Carton", canonicalField: null, confidence: "low", reason: "pack_price_conflict" },
      ],
    });
    expect(evaluated[0]?.blocking).toBe(true);
    expect(evaluated[0]?.issues.some((i) => i.kind === "mapping_pack_price_conflict" && i.severity === "error")).toBe(
      true,
    );

    const summary = summarizeImportReview(evaluated);
    expect(summary.errorRows).toBe(1);
    expect(summary.ready).toBe(0);
  });
});
