import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Inventory date chips stay Inventory-owned", () => {
  it("Purchases and Payments use InventoryDateFilterChips, not Sales History chips", () => {
    const purchases = src("src/features/inventory-purchasing/components/PurchasesTab.tsx");
    const payments = src("src/features/inventory-purchasing/components/PaymentsTab.tsx");
    expect(purchases).toContain("InventoryDateFilterChips");
    expect(payments).toContain("InventoryDateFilterChips");
    expect(purchases).not.toContain("SalesHistoryDateFilterChips");
    expect(payments).not.toContain("SalesHistoryDateFilterChips");
  });

  it("keeps the same DateFilterValue contract as the shared Sales History chips", () => {
    const inventory = src("src/features/inventory-purchasing/components/InventoryDateFilterChips.tsx");
    const sales = src("src/components/receipts/SalesHistoryDateFilterChips.tsx");
    expect(inventory).toContain('fromKey: "2020-01-01"');
    expect(sales).toContain('fromKey: "2020-01-01"');
    expect(inventory).toContain('onFilterChange({ kind: "day", dateKey: v })');
    expect(sales).toContain('onFilterChange({ kind: "day", dateKey: v })');
    expect(inventory).toContain('onFilterChange({ kind: "preset", preset: chipId })');
    expect(sales).toContain('onFilterChange({ kind: "preset", preset: chipId })');
  });

  it("INV-D1: purchaseFilterFromDateFilter keeps ranges as ranges for Purchases and Payments", () => {
    const mapper = src("src/lib/purchaseReporting.ts");
    expect(mapper).toContain('if (value.kind === "range") return { kind: "range", fromKey: value.fromKey, toKey: value.toKey }');
    expect(mapper).not.toContain('if (value.kind === "range") return { kind: "day", dateKey: value.fromKey }');

    const purchases = src("src/features/inventory-purchasing/components/PurchasesTab.tsx");
    const payments = src("src/features/inventory-purchasing/components/PaymentsTab.tsx");
    expect(purchases).toContain("purchaseFilterFromDateFilter");
    expect(payments).toContain("purchaseFilterFromDateFilter");
  });
});
