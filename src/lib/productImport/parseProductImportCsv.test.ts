import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePosStore } from "../../store/usePosStore";
import { createDefaultPreferences } from "../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../storeSubscriptionContext";
import { defaultWizardUnitCostUgx } from "../simpleProductWizard";
import { parseAiBulkInventory } from "../ai/aiBusinessSchemas";
import { mapBulkRowsToQuickAdd } from "../ai/bulkInventoryAi";
import type { CatalogPickerItem } from "../catalogHierarchy";
import { buildProductFromSimpleWizard } from "../simpleProductWizard";
import { unitCostFromPackTotal } from "../costPrecision";
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
import {
  buildWakaProductImportNoPackExampleCsv,
  buildWakaProductImportNoPackTemplateCsv,
  buildWakaProductImportWithPackExampleCsv,
  buildWakaProductImportWithPackTemplateCsv,
} from "./csvTemplate";
import {
  CSV_TEMPLATE_A_COLUMNS,
  CSV_TEMPLATE_B_COLUMNS,
  officialCsvImportHeadersNoPack,
  officialCsvImportHeadersWithPack,
} from "./csvColumns";
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

function csvA(body: string): string {
  return `${officialCsvImportHeadersNoPack().join(",")}\n${body}`;
}

function csvB(body: string): string {
  return `${officialCsvImportHeadersWithPack().join(",")}\n${body}`;
}

describe("CSV text parser", () => {
  it("parses quoted values and commas inside names", () => {
    const parsed = parseCsvText('Product name,Selling price\n"Cooking oil, 1L",5500\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.records[1]?.[0]).toBe("Cooking oil, 1L");
    expect(parsed.records[1]?.[1]).toBe("5500");
  });

  it("reports unclosed quotes with a row number", () => {
    const parsed = parseCsvText('a,b\n"open,1\n');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.kind).toBe("unclosed_quote");
    expect(parsed.rowNumber).toBe(2);
  });
});

describe("Template A — No Packs", () => {
  it("maps a valid no-pack row", () => {
    const result = parseProductImportCsv(csvA("Sugar 1kg,Groceries,kg,10,2800,3500\n"));
    expect(result.ok).toBe(true);
    expect(result.templateKind).toBe("no_packs");
    expect(result.rows[0]?.packMode).toBe("none");
    expect(result.rows[0]?.name).toBe("Sugar 1kg");
    expect(result.rows[0]?.categoryInput).toBe("Groceries");
    expect(result.rows[0]?.baseUnit).toBe("kg");
    expect(result.rows[0]?.stockQty).toBe(10);
    expect(result.rows[0]?.costPricePerUnitUgx).toBe(2800);
    expect(result.rows[0]?.sellingPriceUgx).toBe(3500);
    expect(result.rows[0]?.conversionRate).toBeNull();
    expect(result.rows[0]?.buyingPackCostUgx).toBeNull();
  });

  it("fails when selling price column is missing", () => {
    const result = parseProductImportCsv("Product name,Section\nSugar,Groceries\n");
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.kind === "missing_column" || result.issues[0]?.kind === "unrecognized_template").toBe(
      true,
    );
  });

  it("preserves provided cost and missing cost", () => {
    const parsed = parseProductImportCsv(csvA("Soap,Household,piece,1,900,2000\nOil,Household,piece,1,,2000\n"));
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBe(900);
    expect(parsed.rows[1]?.costPricePerUnitUgx).toBeNull();
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.costStatus).toBe("provided");
    expect(evaluated[1]?.costStatus).toBe("missing_fallback");
    expect(evaluated[1]?.fallbackCostUgx).toBe(defaultWizardUnitCostUgx(2000));
  });

  it("maps opening quantity as sell units", () => {
    const parsed = parseProductImportCsv(csvA("Rice,Grain,kg,12,3000,4000\n"));
    expect(parsed.rows[0]?.stockQty).toBe(12);
    expect(mapNormalizedRowsToBulkQuickAdd(parsed.rows)[0]?.stockQty).toBe(12);
  });

  it("resolves a unique section and blocks an ambiguous leaf", () => {
    const unique = parseProductImportCsv(csvA("Coke,SODA-COLD,bottle,1,800,1500\n"));
    const amb = parseProductImportCsv(csvA("Sprite,Soda,bottle,1,800,1500\n"));
    const ok = evaluateNormalizedProductRows({ rows: unique.rows, pickerItems: [sodaA, sodaB] });
    expect(ok[0]?.row.category).toBe("SODA-COLD");
    const bad = evaluateNormalizedProductRows({ rows: amb.rows, pickerItems: [sodaA, sodaB] });
    expect(bad[0]?.issues.some((i) => i.kind === "ambiguous_category")).toBe(true);
    expect(importHasBlockingIssues(bad)).toBe(true);
  });

  it("cannot accidentally become packed", () => {
    const row = createNormalizedProductImportRow({
      name: "Hack",
      sellingPriceUgx: 1000,
      packMode: "none",
      conversionRate: 24,
      stockQty: 1,
    });
    const evaluated = evaluateNormalizedProductRows({ rows: [row], pickerItems: [] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "invalid_pack")).toBe(true);
    const mapped = mapNormalizedRowsToBulkQuickAdd([row]);
    expect(mapped[0]?.conversionRate).toBeUndefined();
    expect(mapped[0]?.buyingUnit).toBeUndefined();
  });

  it("uses official Template A headers", () => {
    expect(officialCsvImportHeadersNoPack()).toEqual([
      CSV_TEMPLATE_A_COLUMNS.name,
      CSV_TEMPLATE_A_COLUMNS.section,
      CSV_TEMPLATE_A_COLUMNS.unit,
      CSV_TEMPLATE_A_COLUMNS.openingQty,
      CSV_TEMPLATE_A_COLUMNS.costPrice,
      CSV_TEMPLATE_A_COLUMNS.sellingPrice,
    ]);
    expect(parseProductImportCsv(buildWakaProductImportNoPackExampleCsv()).ok).toBe(true);
    expect(parseProductImportCsv(buildWakaProductImportNoPackTemplateCsv()).ok).toBe(false);
  });
});

describe("Template B — With Packs", () => {
  it("maps a valid packed row with wizard conversions", () => {
    const result = parseProductImportCsv(
      csvB("Coca Cola 500ml,Drinks,Piece,Crate,24,48,18000,2000\n"),
    );
    expect(result.ok).toBe(true);
    expect(result.templateKind).toBe("with_packs");
    const row = result.rows[0]!;
    expect(row.packMode).toBe("packed");
    expect(row.buyingUnit).toBe("crate");
    expect(row.conversionRate).toBe(24);
    expect(row.openingPacks).toBe(48);
    expect(row.stockQty).toBe(1152);
    expect(row.buyingPackCostUgx).toBe(18000);
    expect(row.costPricePerUnitUgx).toBe(unitCostFromPackTotal(18000, 24));
    expect(row.costPricePerUnitUgx).toBe(750);
    expect(row.sellingPriceUgx).toBe(2000);
  });

  it("Coca Cola regression through commit → bulkQuickAddProducts", () => {
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
    const wrapped = vi.fn((rows: BulkQuickAddProductRow[]) => usePosStore.getState().bulkQuickAddProducts(rows));
    const parsed = parseProductImportCsv(csvB("Coca Cola 500ml,Drinks,Piece,Crate,24,48,18000,2000\n"));
    const result = commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: wrapped,
      pickerItems: [],
    });
    expect(wrapped).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false);
    expect(result.added).toBe(1);
    const product = usePosStore.getState().products.find((p) => p.name === "Coca Cola 500ml");
    expect(product?.stockOnHand).toBe(1152);
    expect(product?.costPricePerUnitUgx).toBe(750);
    expect(product?.buyingPackCostUgx).toBe(18000);
    expect(product?.conversionRate).toBe(24);
    expect(product?.buyingUnit).toBe("crate");
    expect(product?.sellingPricePerUnitUgx).toBe(2000);
  });

  it("opening packs empty means zero packs", () => {
    const parsed = parseProductImportCsv(csvB("Soda,Drinks,bottle,crate,24,,9000,1500\n"));
    expect(parsed.rows[0]?.openingPacks).toBe(0);
    expect(parsed.rows[0]?.stockQty).toBe(0);
  });

  it("missing cost per pack uses 72% fallback — not sell-unit cost invent", () => {
    const parsed = parseProductImportCsv(csvB("Soda,Drinks,bottle,crate,24,2,,1500\n"));
    expect(parsed.rows[0]?.buyingPackCostUgx).toBeNull();
    expect(parsed.rows[0]?.costPricePerUnitUgx).toBeNull();
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.costStatus).toBe("missing_fallback");
    expect(evaluated[0]?.issues.some((i) => i.kind === "cost_fallback")).toBe(true);
    const mapped = mapNormalizedRowsToBulkQuickAdd(parsed.rows);
    expect(mapped[0]?.costPricePerUnitUgx).toBeUndefined();
    expect(mapped[0]?.buyingPackCostUgx).toBeUndefined();
  });

  it("blocks missing pack size", () => {
    const parsed = parseProductImportCsv(csvB("Soda,Drinks,bottle,crate,,2,9000,1500\n"));
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "invalid_pack")).toBe(true);
    expect(importHasBlockingIssues(evaluated)).toBe(true);
  });

  it("blocks pack size of 1 (not packed)", () => {
    const parsed = parseProductImportCsv(csvB("Soda,Drinks,bottle,crate,1,2,9000,1500\n"));
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "invalid_pack")).toBe(true);
  });

  it("blocks missing pack label", () => {
    const parsed = parseProductImportCsv(csvB("Soda,Drinks,bottle,,24,2,9000,1500\n"));
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "missing_pack_label")).toBe(true);
  });

  it("records invalid numeric values", () => {
    const parsed = parseProductImportCsv(csvB("Oil,Groceries,piece,crate,abc,nope,xyz,bad\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.issues.every((i) => i.rowNumber === 2)).toBe(true);
  });

  it("cannot accidentally become unpacked on map", () => {
    const parsed = parseProductImportCsv(csvB("Soda,Drinks,bottle,crate,24,2,9000,1500\n"));
    const mapped = mapNormalizedRowsToBulkQuickAdd(parsed.rows);
    expect(mapped[0]?.conversionRate).toBe(24);
    expect(mapped[0]?.buyingUnit).toBe("crate");
    expect(mapped[0]?.buyingPackCostUgx).toBe(9000);
  });

  it("section resolution works the same as Template A", () => {
    const amb = parseProductImportCsv(csvB("Sprite,Soda,bottle,crate,24,1,800,1500\n"));
    const bad = evaluateNormalizedProductRows({ rows: amb.rows, pickerItems: [sodaA, sodaB] });
    expect(bad[0]?.issues.some((i) => i.kind === "ambiguous_category")).toBe(true);
  });

  it("uses official Template B headers", () => {
    expect(officialCsvImportHeadersWithPack()).toEqual([
      CSV_TEMPLATE_B_COLUMNS.name,
      CSV_TEMPLATE_B_COLUMNS.section,
      CSV_TEMPLATE_B_COLUMNS.unit,
      CSV_TEMPLATE_B_COLUMNS.packLabel,
      CSV_TEMPLATE_B_COLUMNS.packSize,
      CSV_TEMPLATE_B_COLUMNS.openingPacks,
      CSV_TEMPLATE_B_COLUMNS.costPerPack,
      CSV_TEMPLATE_B_COLUMNS.sellingPrice,
    ]);
    expect(parseProductImportCsv(buildWakaProductImportWithPackExampleCsv()).ok).toBe(true);
    expect(parseProductImportCsv(buildWakaProductImportWithPackTemplateCsv()).ok).toBe(false);
  });
});

describe("Legacy / safety", () => {
  it("rejects the old mixed 7-column template", () => {
    const legacy =
      "Product name,Section,Unit,Pack size,Opening quantity,Cost price,Selling price\nSoda,Drinks,bottle,24,48,,1500\n";
    const result = parseProductImportCsv(legacy);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.kind).toBe("legacy_template");
    expect(result.issues[0]?.messageKey).toBe("csvImportLegacyTemplateRejected");
  });

  it("ignores SKU and other internal columns on Template A minimal headers", () => {
    const result = parseProductImportCsv("Product name,SKU,tax_rate,Selling price\nSoap,SKU-1,0.18,2000\n");
    expect(result.ok).toBe(true);
    expect(result.rows[0]?.name).toBe("Soap");
    expect(result.rows[0]?.sellingPriceUgx).toBe(2000);
    expect(result.rows[0]?.packMode).toBe("none");
  });

  it("duplicate names in the CSV block commit and are not merged", () => {
    const parsed = parseProductImportCsv(csvA("Sugar,Groceries,piece,1,800,1000\nsugar,Groceries,piece,2,700,1200\n"));
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
    const parsed = parseProductImportCsv(csvA(" ,Groceries,piece,1,800,0\n"));
    const bulk = vi.fn();
    const result = commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: bulk,
      pickerItems: [],
    });
    expect(result.blocked).toBe(true);
    expect(bulk).not.toHaveBeenCalled();
  });
});

describe("CSV review + commit save path", () => {
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

  it("commit uses commitNormalizedProductImport → bulkQuickAddProducts (Template A)", () => {
    const wrapped = vi.fn((rows: BulkQuickAddProductRow[]) => usePosStore.getState().bulkQuickAddProducts(rows));
    const parsed = parseProductImportCsv(csvA("Imported Tea,Drinks,piece,8,3200,5000\n"));
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
  });

  it("missing CSV cost uses the existing 72% draft fallback on commit", () => {
    const parsed = parseProductImportCsv(csvA("Imported Soap,Household,piece,0,,2000\n"));
    commitNormalizedProductImport({
      rows: parsed.rows,
      bulkQuickAddProducts: usePosStore.getState().bulkQuickAddProducts,
      pickerItems: [],
    });
    const product = usePosStore.getState().products.find((p) => p.name === "Imported Soap");
    expect(product?.costPricePerUnitUgx).toBe(defaultWizardUnitCostUgx(2000));
  });

  it("review summary counts detected, ready, warnings, and errors", () => {
    const parsed = parseProductImportCsv(
      csvA("Sugar,Groceries,piece,1,,1000\n,Groceries,piece,1,800,0\nSugar,Groceries,piece,1,700,1200\n"),
    );
    const evaluated = evaluateNormalizedProductRows({ rows: parsed.rows, pickerItems: [] });
    const summary = summarizeImportReview(evaluated);
    expect(summary.detected).toBe(3);
    expect(summary.errorRows).toBeGreaterThan(0);
    expect(importHasBlockingIssues(evaluated)).toBe(true);
  });

  it("rejects more than the documented row limit", () => {
    const lines = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => `Item ${i},General,piece,1,800,1000`);
    const result = parseProductImportCsv(csvA(`${lines.join("\n")}\n`));
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.kind).toBe("too_many_rows");
  });
});

describe("CSV numeric helper", () => {
  it("treats blank as empty, not zero", () => {
    expect(parseImportNumber("")).toEqual({ status: "empty" });
    expect(parseImportNumber("UGX 3500")).toEqual({ status: "ok", value: 3500 });
    expect(parseImportNumber("nope")).toEqual({ status: "invalid" });
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
        hasPack: true,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "24",
        stockCount: "48",
        sellPriceUgx: "2000",
        buyPackPriceUgx: "18000",
      },
      "en",
    );
    expect(built?.stockQty).toBe(1152);
    expect(built?.costPricePerUnitUgx).toBe(750);
    expect(built?.buyingPackCostUgx).toBe(18000);
  });

  it("createNormalizedProductImportRow still works for non-CSV sources", () => {
    const row = createNormalizedProductImportRow({ name: "Manual", sellingPriceUgx: 1000 }, "manual");
    expect(row.source).toBe("manual");
    expect(row.packMode).toBe("none");
  });
});
