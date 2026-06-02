import { describe, expect, it } from "vitest";
import {
  buildWholesaleDebtorListPdfBlob,
  buildWholesaleReceivablesPdfBlob,
  wholesaleReceivablesCsv,
  wholesaleReceivablesRows,
} from "./wholesaleDocumentExports";
import type { Customer } from "../types";

const customers: Customer[] = [
  {
    id: "c1",
    name: "Shop A",
    phone: "",
    location: "",
    debtBalanceUgx: 5000,
    createdAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  },
];

describe("wholesaleExport", () => {
  it("lists receivable rows", () => {
    const rows = wholesaleReceivablesRows(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.debt).toBe(5000);
  });

  it("exports receivables CSV", () => {
    const csv = wholesaleReceivablesCsv(wholesaleReceivablesRows(customers));
    expect(csv).toContain("Shop A");
  });

  it("builds receivables PDF", () => {
    const rows = wholesaleReceivablesRows(customers);
    const blob = buildWholesaleReceivablesPdfBlob("en", rows, 5000);
    expect(blob.size).toBeGreaterThan(200);
  });

  it("builds debtor list PDF", () => {
    const blob = buildWholesaleDebtorListPdfBlob("en", wholesaleReceivablesRows(customers));
    expect(blob.size).toBeGreaterThan(200);
  });
});
