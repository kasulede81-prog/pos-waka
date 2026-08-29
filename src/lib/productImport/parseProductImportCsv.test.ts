import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePosStore } from "../../store/usePosStore";
import { createDefaultPreferences } from "../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../storeSubscriptionContext";
import { defaultWizardUnitCostUgx } from "../simpleProductWizard";
import { parseAiBulkInventory } from "../ai/aiBusinessSchemas";
import { mapBulkRowsToQuickAdd } from "../ai/bulkInventoryAi";
import type { CatalogPickerItem } from "../catalogHierarchy";
import { buildProductFromSimpleWizard } from "../simpleProductWizard";
import { commitNormalizedProductImport } from "./commitNormalizedProductImport";
import { createNormalizedProductImportRow } from "./createNormalizedRow";
import {
  evaluateNormalizedProductRows,
  importHasBlockingIssues,
  summarizeImportReview,
} from "./evaluateNormalizedProductRows";
import { mapNormalizedRowsToBulkQuickAdd } from "./mapNormalizedRowsToBulkQuickAdd";
import type { BulkQuickAddProductRow } from "./types";
import { parseCsvText } from "./parseCsvText";
import { parseImportNumber, parseProductImportCsv } from "./parseProductImportCsv";
import { buildWakaProductImportExampleCsv, buildWakaProductImportTemplateCsv } from "./csvTemplate";
import { CSV_IMPORT_COLUMNS, officialCsvImportHeaders } from "./csvColumns";
import { CSV_IMPORT_MAX_ROWS } from "./csvLimits";

const sodaA: CatalogPickerItem = {
  id: "a",
  parentId: "drinks",
  name: "Soda",
  legacyShelfKey: "SODA-COLD",
  depth: 1,
  pathLabels: ["Drinks", "Soda"],
  persisted: true,
  sortOrder: 0,
};
const sodaB: CatalogPickerItem = {
  id: "b",
  parentId: "snacks",
  name: "Soda",
  legacyShelfKey: "SODA-SNACKS",
  depth: 1,
  pathLabels: ["Snacks", "Soda"],
  persisted: true,
  sortOrder: 1,
};

function csv(body: string): string {
  return `${officialCsvImportHeaders().join(",")}\n${body}`;
}

describe("CSV text parser", () => {
  it("parses quoted values and commas inside names", () => {
    const parsed = parseCsvText('Product name,Selling price\n"Cooking oil, 1L",5500\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.records[1]?.[0]).toBe("Cooking oil, 1L");
    expect(parsed.records[1]?.[1]).toBe("5500");
  });

  it("parses escaped quotes", () => {
    const parsed = parseCsvText('a,b\n"He said ""hello""",1\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.records[1]?.[0]).toBe('He said "hello"');
  });

  it("reports unclosed quotes with a row number", () => {
    const parsed = parseCsvText('a,b\n"open,1\n');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.kind).toBe("unclosed_quote");
    expect(parsed.rowNumber).toBe(2);
  });
});

describe("CSV → NormalizedProductImportRow", () => {
  it("maps a valid CSV with source csv", () => {
    const result = parseProductImportCsv(
      csv("Sugar 1kg,Groceries,kg,,10,2800,3500\nSoda,Drinks,bottle,24,48,,1500\n"),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.source === "csv")).toBe(true);
    expect(result.rows[0]?.name).toBe("Sugar 1kg");
    expect(result.rows[0]?.categoryInput).toBe("Groceries");
    expect(result.rows[0]?.baseUnit).toBe("kg");
    expect(result.rows[0]?.stockQty).toBe(10);
    expect(result.rows[0]?.costPricePerUnitUgx).toBe(2800);
    expect(result.rows[0]?.sellingPriceUgx).toBe(3500);
    expect(result.rows[0]?.sourceRowNumber).toBe(2);
    expect(result.rows[1]?.conversionRate).toBe(24);
    expect(result.rows[1]?.stockQty).toBe(48);
    expect(result.rows[1]?.costPricePerUnitUgx).toBeNull();
  });

  it("keeps UTF-8 names", () => {
    const result = parseProductImportCsv(csv("Café matooke,Groceries,piece,,2,900,1200\n"));
    expect(result.ok).toBe(true);
    expect(result.rows[0]?.name).toBe("Café matooke");
  });

  it("skips blank rows but does not drop real rows", () => {
    const result = parseProductImportCsv(csv("Sugar,Groceries,piece,,1,800,1000\n\n\nSalt,Groceries,piece,,1,400,600\n"));
    expect(result.ok).toBe(true);
    expect(result.blankRowCount).toBe(2);
    expect(result.rows.map((r) => r.name)).toEqual(["Sugar", "Salt"]);
    expect(result.rows[1]?.sourceRowNumber).toBe(5);
  });

  it("fails on malformed CSV instead of discarding it", () => {
    const result = parseProductImportCsv('Product name,Selling price\n"bad,1000\n');
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]?.kind).toBe("malformed_csv");
    expect(result.issues[0]?.rowNumber).toBe(2);
  });

  it("fails when required columns are missing", () => {
    const result = parseProductImportCsv("Product name,Section\nSugar,Groceries\n");
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.kind).toBe("missing_column");
    expect(result.issues[0]?.column).toContain("Selling price");
  });

  it("ignores SKU and other internal columns", () => {
    const result = parseProductImportCsv(
      "Product name,SKU,tax_rate,Selling price\nSoap,SKU-1,0.18,2000\n",
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0]?.name).toBe("Soap");
    expect(result.rows[0]?.sellingPriceUgx).toBe(2000);
  });

  it("accepts quoted thousands separators in prices", () => {
    const result = parseProductImportCsv(csv('Rice,Grain,kg,,"12","1,200","1,500"\n'));
    expect(result.ok).toBe(true);
    expect(result.rows[0]?.costPricePerUnitUgx).toBe(1200);
    expect(result.rows[0]?.sellingPriceUgx).toBe(1500);
    expect(result.rows[0]?.stockQty).toBe(12);
  });

  it("records invalid numbers with row numbers and still includes the row", () => {
    const result = parseProductImportCsv(csv("Oil,Groceries,piece,,abc,nope,xyz\n"));
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.issues.map((i) => i.kind)).toEqual(["invalid_number", "invalid_number", "invalid_number"]);
    expect(result.issues.every((i) => i.rowNumber === 2)).toBe(true);
    expect(Number.isNaN(result.rows[0]?.stockQty)).toBe(true);
    expect(result.rows[0]?.sellingPriceUgx).toBe(0);
    expect(Number.isNaN(result.rows[0]?.costPricePerUnitUgx)).toBe(true);
  });

  it("strips a UTF-8 BOM", () => {
    const result = parseProductImportCsv(`\uFEFF${csv("Soap,Household,piece,,1,900,2000\n")}`);
    expect(result.ok).toBe(true);
    expect(result.rows[0]?.name).toBe("Soap");
  });

  it("uses the official template headers", () => {
    expect(officialCsvImportHeaders()).toEqual([
      CSV_IMPORT_COLUMNS.name,
      CSV_IMPORT_COLUMNS.section,
      CSV_IMPORT_COLUMNS.unit,
      CSV_IMPORT_COLUMNS.packSize,
      CSV_IMPORT_COLUMNS.openingQty,
      CSV_IMPORT_COLUMNS.costPrice,
      CSV_IMPORT_COLUMNS.sellingPrice,
    ]);
    const parsed = parseProductImportCsv(buildWakaProductImportExampleCsv());
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[2]?.name).toBe("Cooking oil, 1L");
    expect(parseProductImportCsv(buildWakaProductImportTemplateCsv()).ok).toBe(false);
  });
});

describe("CSV numeric helper", () => {
  it("treats blank as empty, not zero", () => {
    expect(parseImportNumber("")).toEqual({ status: "empty" });
    expect(parseImportNumber("  ")).toEqual({ status: "empty" });
    expect(parseImportNumber("UGX 3500")).toEqual({ status: "ok", value: 3500 });
    expect(parseImportNumber("nope")).toEqual({ status: "invalid" });
  });
});

describe("CSV cost, stock, and category", () => {
  it("preserves provided cost and leaves missing cost missing", () => {
    const parsed = parseProductImportCsv(csv("Soap,Household,piece,,1,900,2000\nOil,Household,piece,,1,,2000\n"));
    const mapped = mapNormalizedRowsToBulkQuickAdd(parsed.rows);
    expect(mapped[0]?.costPricePerUnitUgx).toBe(900);
    expect(mapped[1]?.costPricePerUnitUgx).toBeUndefined();
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.costStatus).toBe("provided");
    expect(evaluated[1]?.costStatus).toBe("missing_fallback");
    expect(evaluated[1]?.fallbackCostUgx).toBe(defaultWizardUnitCostUgx(2000));
  });

  it("maps opening quantity to stockQty", () => {
    const parsed = parseProductImportCsv(csv("Rice,Grain,kg,,12,3000,4000\n"));
    expect(parsed.rows[0]?.stockQty).toBe(12);
    expect(mapNormalizedRowsToBulkQuickAdd(parsed.rows)[0]?.stockQty).toBe(12);
  });

  it("resolves a unique section and blocks an ambiguous leaf", () => {
    const unique = parseProductImportCsv(csv("Coke,SODA-COLD,bottle,,1,800,1500\n"));
    const amb = parseProductImportCsv(csv("Sprite,Soda,bottle,,1,800,1500\n"));
    const ok = evaluateNormalizedProductRows({ rows: unique.rows, pickerItems: [sodaA, sodaB] });
    expect(ok[0]?.row.category).toBe("SODA-COLD");
    const bad = evaluateNormalizedProductRows({ rows: amb.rows, pickerItems: [sodaA, sodaB] });
    expect(bad[0]?.issues.some((i) => i.kind === "ambiguous_category")).toBe(true);
    expect(importHasBlockingIssues(bad)).toBe(true);
  });

  it("warns on an unknown section instead of inventing a folder match", () => {
    const parsed = parseProductImportCsv(csv("Tea,BrandNewShelf,piece,,1,500,900\n"));
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [sodaA] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "unresolved_category" && i.severity === "warning")).toBe(true);
    expect(importHasBlockingIssues(evaluated)).toBe(false);
  });
});

describe("CSV review + commit", () => {
  beforeEach(() => {
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
  });

  it("review summary counts detected, ready, warnings, and errors", () => {
    const parsed = parseProductImportCsv(
      csv("Sugar,Groceries,piece,,1,,1000\n,Groceries,piece,,1,800,0\nSugar,Groceries,piece,,1,700,1200\n"),
    );
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    const summary = summarizeImportReview(evaluated);
    expect(summary.detected).toBe(3);
    expect(summary.errorRows).toBeGreaterThan(0);
    expect(summary.ready).toBeLessThan(summary.detected);
    expect(importHasBlockingIssues(evaluated)).toBe(true);
  });

  it("duplicate names in the CSV block commit and are not merged", () => {
    const parsed = parseProductImportCsv(csv("Sugar,Groceries,piece,,1,800,1000\nsugar,Groceries,piece,,2,700,1200\n"));
    expect(parsed.rows).toHaveLength(2);
    const bulk = vi.fn();
    const result = commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: bulk,
      pickerItems: [],
    });
    expect(result.blocked).toBe(true);
    expect(bulk).not.toHaveBeenCalled();
  });

  it("blocking errors prevent bulkQuickAddProducts", () => {
    const parsed = parseProductImportCsv(csv(" ,Groceries,piece,,1,800,0\n"));
    const bulk = vi.fn();
    const result = commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: bulk,
      pickerItems: [],
    });
    expect(result.blocked).toBe(true);
    expect(result.added).toBe(0);
    expect(bulk).not.toHaveBeenCalled();
  });

  it("commit uses commitNormalizedProductImport → bulkQuickAddProducts with opening stock and cost", () => {
    const wrapped = vi.fn((rows: BulkQuickAddProductRow[]) => usePosStore.getState().bulkQuickAddProducts(rows));
    const parsed = parseProductImportCsv(csv("Imported Tea,Drinks,piece,,8,3200,5000\n"));
    const result = commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: wrapped,
      pickerItems: [],
    });
    expect(wrapped).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false);
    expect(result.added).toBe(1);
    const product = usePosStore.getState().products.find((p) => p.name === "Imported Tea");
    expect(product?.stockOnHand).toBe(8);
    expect(product?.costPricePerUnitUgx).toBe(3200);
    expect(usePosStore.getState().stockMovements.some((m) => m.kind === "opening_stock" && m.deltaBaseUnits === 8)).toBe(
      true,
    );
  });

  it("missing CSV cost uses the existing 72% draft fallback on commit", () => {
    const parsed = parseProductImportCsv(csv("Imported Soap,Household,piece,,0,,2000\n"));
    commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: usePosStore.getState().bulkQuickAddProducts,
      pickerItems: [],
    });
    const product = usePosStore.getState().products.find((p) => p.name === "Imported Soap");
    expect(product?.costPricePerUnitUgx).toBe(defaultWizardUnitCostUgx(2000));
  });

  it("unauthorized cashier cannot import via bulkQuickAddProducts", () => {
    usePosStore.setState({
      sessionActor: { userId: "cashier:1", role: "cashier", displayName: "Cashier" },
    });
    const parsed = parseProductImportCsv(csv("Banned,Household,piece,,1,800,2000\n"));
    const result = commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: usePosStore.getState().bulkQuickAddProducts,
      pickerItems: [],
    });
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(usePosStore.getState().products).toHaveLength(0);
  });

  it("rejects more than the documented row limit", () => {
    const lines = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => `Item ${i},General,piece,,1,800,1000`);
    const result = parseProductImportCsv(csv(`${lines.join("\n")}\n`));
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.kind).toBe("too_many_rows");
  });
});

describe("CSV adapter does not change existing create paths", () => {
  it("AI bulk mapping is unchanged", () => {
    const mapped = mapBulkRowsToQuickAdd([
      {
        name: "Soap",
        category: "Household",
        unit: "piece",
        sellingMode: "unit",
        suggestedPriceUgx: 2000,
        enabled: true,
        stockQty: 5,
        priceUgx: 2000,
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.stockQty).toBe(5);
    const rows = parseAiBulkInventory({
      products: [{ name: "Sugar 1kg", category: "Groceries", unit: "kg", sellingMode: "weighted", suggestedPriceUgx: 3500 }],
    });
    expect(rows[0]?.name).toBe("Sugar 1kg");
  });

  it("manual wizard builder is unchanged", () => {
    const built = buildProductFromSimpleWizard(
      {
        name: "Soda",
        shelf: "Drinks",
        sellUnit: "bottle",
        sellUnitCustom: "",
        hasPack: false,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "",
        stockCount: "4",
        sellPriceUgx: "1500",
        buyPackPriceUgx: "",
      },
      "en",
    );
    expect(built?.name).toBe("Soda");
    expect(built?.priceUgx).toBe(1500);
  });

  it("createNormalizedProductImportRow still works for non-CSV sources", () => {
    const row = createNormalizedProductImportRow({ name: "Manual", sellingPriceUgx: 1000 }, "manual");
    expect(row.source).toBe("manual");
  });
});
