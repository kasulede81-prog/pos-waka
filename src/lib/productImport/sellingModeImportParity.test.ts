/**
 * Regression tests for wizard-parity `sellingMode` derivation on import rows.
 *
 * Root cause fixed: `mapNoPackRecord` / `mapWithPackRecord` never set
 * `NormalizedProductImportRow.sellingMode`, so every CSV/Excel row fell back to
 * `buildQuickAddProductDraft`'s product-name keyword guess instead of the
 * explicit "Unit" column — even though the wizard itself derives `sellingMode`
 * deterministically from the sell unit via `sellingModeFromSellKind()`, never
 * from the product name, once a unit is known.
 *
 * These tests use product names that do NOT match any `smartProductGuess`
 * keyword, so a passing result proves the unit — not the name — decided
 * `sellingMode`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { usePosStore } from "../../store/usePosStore";
import { createDefaultPreferences } from "../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../storeSubscriptionContext";
import { buildProductFromSimpleWizard } from "../simpleProductWizard";
import { commitNormalizedProductImport } from "./commitNormalizedProductImport";
import { parseProductImportCsv } from "./parseProductImportCsv";
import { parseProductImportWorkbook } from "./parseProductImportExcel";
import { officialCsvImportHeadersNoPack } from "./csvColumns";
import { sellingModeFromImportUnit } from "./packImportSemantics";
import type { NormalizedProductImportRow } from "./types";

function csvA(body: string): string {
  return `${officialCsvImportHeadersNoPack().join(",")}\n${body}`;
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

describe("sellingMode is derived from the explicit Unit column, not the product name", () => {
  beforeEach(() => {
    seedStore();
  });

  it("TEST A — kg, non-keyword name -> weighted", () => {
    const parsed = parseProductImportCsv(
      csvA("Semolina Repack,Groceries,kg,100,3000,4500\n"),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.sellingMode).toBe("weighted");

    expect(commitViaStore(parsed.rows).added).toBe(1);
    const product = usePosStore.getState().products[0]!;
    expect(product.baseUnit).toBe("kg");
    expect(product.sellingMode).toBe("weighted");
    expect(product.sellingPricePerUnitUgx).toBe(4500);
    expect(product.costPricePerUnitUgx).toBe(3000);
    expect(product.stockOnHand).toBe(100);
  });

  it("TEST A2 — kg, non-keyword name -> weighted, via the Excel adapter", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      officialCsvImportHeadersNoPack(),
      ["Kawunyonyi Retail Pack", "Groceries", "kg", 100, 3000, 4500],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

    const parsed = await parseProductImportWorkbook(bytes);
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.source).toBe("excel");
    expect(parsed.rows[0]?.sellingMode).toBe("weighted");

    expect(commitViaStore(parsed.rows).added).toBe(1);
    expect(usePosStore.getState().products[0]?.sellingMode).toBe("weighted");
  });

  it("TEST B — litre, non-keyword name -> weighted", () => {
    const parsed = parseProductImportCsv(
      csvA("Random Product 123,Household,litre,10,2000,3000\n"),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.sellingMode).toBe("weighted");

    expect(commitViaStore(parsed.rows).added).toBe(1);
    expect(usePosStore.getState().products[0]?.sellingMode).toBe("weighted");
  });

  it("TEST C — piece, non-keyword name -> unit", () => {
    const parsed = parseProductImportCsv(
      csvA("Random Product 123,Household,piece,10,2000,3000\n"),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.sellingMode).toBe("unit");

    expect(commitViaStore(parsed.rows).added).toBe(1);
    expect(usePosStore.getState().products[0]?.sellingMode).toBe("unit");
  });

  it("TEST D — bottle, non-keyword name -> unit", () => {
    const parsed = parseProductImportCsv(
      csvA("Random Product 123,Household,bottle,10,2000,3000\n"),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]?.sellingMode).toBe("unit");

    expect(commitViaStore(parsed.rows).added).toBe(1);
    expect(usePosStore.getState().products[0]?.sellingMode).toBe("unit");
  });

  it("sellingModeFromImportUnit() matches the wizard's own sellingModeFromSellKind() mapping", () => {
    expect(sellingModeFromImportUnit("kg")).toBe("weighted");
    expect(sellingModeFromImportUnit("Kg")).toBe("weighted");
    expect(sellingModeFromImportUnit("litre")).toBe("weighted");
    expect(sellingModeFromImportUnit("liter")).toBe("weighted");
    expect(sellingModeFromImportUnit("piece")).toBe("unit");
    expect(sellingModeFromImportUnit("bottle")).toBe("unit");
    expect(sellingModeFromImportUnit("packet")).toBe("unit");
    // Unrecognized unit text falls back to the wizard's own "custom" handling —
    // still unit-mode unless the custom text itself says kg/litre.
    expect(sellingModeFromImportUnit("jar")).toBe("unit");
    expect(sellingModeFromImportUnit("")).toBe("unit");
  });

  it("TRUE PARITY — wizard and import produce the same canonical Product for identical inputs", () => {
    // Import path
    const parsed = parseProductImportCsv(
      csvA("Semolina Repack,Groceries,kg,100,3000,4500\n"),
    );
    expect(commitViaStore(parsed.rows).added).toBe(1);
    const imported = usePosStore.getState().products[0]!;

    // Wizard path — same product, same inputs, no pack.
    const wizardDraft = buildProductFromSimpleWizard(
      {
        name: "Semolina Repack",
        shelf: "Groceries",
        sellUnit: "kg",
        sellUnitCustom: "",
        hasPack: false,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "",
        stockCount: "100",
        sellPriceUgx: "4500",
        buyPackPriceUgx: "3000",
      },
      "en",
    )!;
    expect(wizardDraft).toBeTruthy();

    seedStore();
    const wizardResult = usePosStore.getState().bulkQuickAddProducts([wizardDraft]);
    expect(wizardResult.added).toBe(1);
    const wizardProduct = usePosStore.getState().products[0]!;

    // The key assertion this whole fix is about:
    expect(wizardProduct.sellingMode).toBe("weighted");
    expect(imported.sellingMode).toBe("weighted");
    expect(imported.sellingMode).toBe(wizardProduct.sellingMode);

    // Full canonical-field parity, ignoring identity/timestamp fields.
    expect(imported.name).toBe(wizardProduct.name);
    expect(imported.category).toBe(wizardProduct.category);
    expect(imported.baseUnit).toBe(wizardProduct.baseUnit);
    expect(imported.stockOnHand).toBe(wizardProduct.stockOnHand);
    expect(imported.stockOnHand).toBe(100);
    expect(imported.sellingPricePerUnitUgx).toBe(wizardProduct.sellingPricePerUnitUgx);
    expect(imported.sellingPricePerUnitUgx).toBe(4500);
    expect(imported.costPricePerUnitUgx).toBe(wizardProduct.costPricePerUnitUgx);
    expect(imported.costPricePerUnitUgx).toBe(3000);
    expect(imported.buyingPackCostUgx).toBe(wizardProduct.buyingPackCostUgx);
    expect(imported.conversionRate).toBe(wizardProduct.conversionRate);
    expect(imported.buyingUnit).toBe(wizardProduct.buyingUnit);
    expect(imported.minimumStockAlert).toBe(wizardProduct.minimumStockAlert);
  });
});
