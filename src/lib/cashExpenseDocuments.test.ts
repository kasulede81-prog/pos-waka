import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CashExpense } from "../types";
import {
  buildCashExpenseListDocument,
  buildCashExpenseListPdfBlob,
  cashExpenseActorLabel,
  cashExpensePeriodLabel,
  cashExpenseStatusLabel,
  type CashExpenseListDocumentInput,
} from "./cashExpenseDocuments";
import { selectVisibleExpensesForDay, sumDrawerExpenseAmounts } from "./cashExpenses";
import { sumCashExpensesOnDay } from "./cashReconciliation";
import { ugxLabel } from "./reportDocumentModel";

const DAY = "2026-09-05";
const GENERATED = "2026-09-05T12:00:00.000Z";

function expense(partial: Partial<CashExpense> & Pick<CashExpense, "id" | "amountUgx">): CashExpense {
  return {
    category: "Lunch",
    description: "",
    paidOn: DAY,
    createdAt: `${DAY}T09:00:00.000Z`,
    createdByUserId: "owner-1",
    createdByLabel: "Owner",
    approvalStatus: "approved",
    pendingSync: false,
    ...partial,
  };
}

const lunch = expense({
  id: "e-lunch",
  amountUgx: 8_000,
  category: "Lunch",
  description: "Cashier lunch",
  createdAt: `${DAY}T10:15:00.000Z`,
});
const transport = expense({
  id: "e-transport",
  amountUgx: 5_000,
  category: "Transport",
  createdByUserId: "cashier-1",
  createdByLabel: "Jane",
  createdAt: `${DAY}T11:00:00.000Z`,
});
const pending = expense({
  id: "e-pending",
  amountUgx: 3_000,
  category: "Airtime",
  approvalStatus: "pending",
  createdByUserId: "cashier-1",
  createdByLabel: "Jane",
});
const rejected = expense({
  id: "e-rejected",
  amountUgx: 2_000,
  category: "Water",
  approvalStatus: "rejected",
});
const otherDay = expense({
  id: "e-other",
  amountUgx: 50_000,
  paidOn: "2026-09-04",
  createdAt: "2026-09-04T10:00:00.000Z",
});
const deleted = expense({
  id: "e-deleted",
  amountUgx: 9_000,
  deletedAt: `${DAY}T12:00:00.000Z`,
});
const hidden = expense({
  id: "e-hidden",
  amountUgx: 12_000,
  category: "Rent",
  createdByUserId: "other-cashier",
  createdByLabel: "Other",
});

function input(overrides: Partial<CashExpenseListDocumentInput> = {}): CashExpenseListDocumentInput {
  return {
    lang: "en",
    shopName: "Waka Mart",
    shopAddress: "Plot 1 Kampala Road",
    shopPhone: "+256700000000",
    dayKey: DAY,
    expenses: [lunch, transport],
    scope: "all_shop",
    generatedAtIso: GENERATED,
    ...overrides,
  };
}

describe("cash expense list document", () => {
  it("labels full-visibility scope without changing the approved total", () => {
    const selected = selectVisibleExpensesForDay(
      [lunch, transport, pending, rejected, hidden],
      DAY,
      "owner",
      "owner-1",
    );
    const model = buildCashExpenseListDocument(input({ expenses: selected, scope: "all_shop" }));
    expect(model.sections[0]?.rows.find((r) => r.label === "Scope")?.value).toBe("All shop expenses");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.label).toBe("Approved expenses");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(sumDrawerExpenseAmounts(selected)));
    expect(sumDrawerExpenseAmounts(selected)).toBe(sumCashExpensesOnDay([lunch, transport, pending, rejected, hidden], DAY));
  });

  it("labels restricted scope and keeps another cashier's expense out of the total", () => {
    const selected = selectVisibleExpensesForDay(
      [transport, hidden, pending],
      DAY,
      "cashier",
      "cashier-1",
    );
    const model = buildCashExpenseListDocument(input({ expenses: selected, scope: "own" }));
    expect(model.sections[0]?.rows.find((r) => r.label === "Scope")?.value).toBe("My expenses");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.label).toBe("Approved expenses");
    expect(selected.map((e) => e.id)).toEqual(["e-transport", "e-pending"]);
    expect(JSON.stringify(model)).not.toContain("Rent");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(5_000));
    expect(sumDrawerExpenseAmounts(selected)).toBe(5_000);
    expect(sumDrawerExpenseAmounts(selected)).not.toBe(
      sumCashExpensesOnDay([transport, hidden, pending], DAY),
    );
  });

  it("prints the selected day's visible expenses only", () => {
    const selected = selectVisibleExpensesForDay(
      [lunch, transport, otherDay, deleted],
      DAY,
      "owner",
      "owner-1",
    );
    const model = buildCashExpenseListDocument(input({ expenses: selected }));
    const categories = model.sections[1]?.table?.records.map((row) => row[1]) ?? [];
    expect(categories).toEqual(["Transport", "Lunch"]);
    expect(JSON.stringify(model)).not.toContain("e-other");
    expect(JSON.stringify(model)).not.toContain("50,000");
    expect(model.periodLabel).toBe(cashExpensePeriodLabel("en", DAY));
    expect(model.periodLabel).toContain("2026");
  });

  it("preserves the page total: approved drawer expenses only", () => {
    const selected = [lunch, transport, pending, rejected];
    const model = buildCashExpenseListDocument(input({ expenses: selected }));
    expect(model.sections[1]?.table?.records).toHaveLength(4);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(13_000));
    expect(sumDrawerExpenseAmounts(selected)).toBe(13_000);
    expect(sumDrawerExpenseAmounts(selected)).toBe(sumCashExpensesOnDay(selected, DAY));
  });

  it("prints the recorded amounts and actor labels from the expense rows", () => {
    const model = buildCashExpenseListDocument(input());
    const rows = model.sections[1]?.table?.records ?? [];
    expect(rows.some((row) => row[5] === ugxLabel(8_000) && row[2] === "Cashier lunch")).toBe(true);
    expect(rows.some((row) => row[3] === cashExpenseActorLabel(transport))).toBe(true);
  });

  it("prints an empty day without broadening the date", () => {
    const model = buildCashExpenseListDocument(input({ expenses: [] }));
    expect(model.periodLabel).toBe(cashExpensePeriodLabel("en", DAY));
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(0));
    expect(model.sections[1]?.table).toBeUndefined();
    expect(model.sections[1]?.rows[0]?.label).toBe("No expenses recorded for this day.");
  });

  it("keeps long descriptions and categories in the model", () => {
    const long = expense({
      id: "e-long",
      amountUgx: 1_250_000,
      category: "Shop supplies and emergency hardware replacements",
      description:
        "Bought replacement bulbs, packing tape, and a long note that must stay on the statement for the owner.",
    });
    const model = buildCashExpenseListDocument(input({ expenses: [long] }));
    expect(model.sections[1]?.table?.records[0]?.[1]).toBe(long.category);
    expect(model.sections[1]?.table?.records[0]?.[2]).toBe(long.description);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(1_250_000));
  });

  it("builds a multi-page PDF for many expenses", async () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      expense({
        id: `e-${i}`,
        amountUgx: (i + 1) * 500,
        category: `Category ${i + 1} ${"Transport ".repeat(3)}`,
        description: `Long description ${i + 1} ${"note ".repeat(8)}`,
        createdAt: `${DAY}T${String(8 + (i % 10)).padStart(2, "0")}:00:00.000Z`,
      }),
    );
    const docInput = input({ expenses: many });
    const model = buildCashExpenseListDocument(docInput);
    expect(model.sections[1]?.table?.records).toHaveLength(70);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(sumDrawerExpenseAmounts(many)));
    const pdf = await buildCashExpenseListPdfBlob(docInput).text();
    expect(pdf).toContain("Waka Mart");
    expect(pdf).toContain("Plot 1 Kampala Road");
    expect(pdf).toContain("Category 1");
    expect(pdf).toMatch(/Page 1 of [2-9]/);
  });

  it("does not include expenses the actor cannot already view", () => {
    const selected = selectVisibleExpensesForDay(
      [transport, hidden],
      DAY,
      "cashier",
      "cashier-1",
    );
    const model = buildCashExpenseListDocument(input({ expenses: selected }));
    expect(selected.map((e) => e.id)).toEqual(["e-transport"]);
    expect(JSON.stringify(model)).not.toContain("Other");
    expect(JSON.stringify(model)).not.toContain("Rent");
    expect(sumDrawerExpenseAmounts(selected)).toBe(5_000);
  });

  it("print and PDF share one document model", () => {
    const first = buildCashExpenseListDocument(input());
    const second = buildCashExpenseListDocument(input());
    expect(first).toEqual(second);
    expect(first.kind).toBe("cash_expenses");
  });

  it("does not introduce a second expense-accounting formula", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "cashExpenseDocuments.ts"), "utf8");
    expect(src).toContain("sumDrawerExpenseAmounts");
    expect(src).not.toContain("sumCashExpensesOnDay");
    expect(src).not.toContain("calculateExpense");
    expect(src).not.toContain("wakapos://");
    expect(src).not.toContain("printQueue");
    expect(src).not.toContain("printSaleReceipt");
    expect(src).not.toContain("hasActorPermission");
    expect(src).not.toContain("back_office.access");
    expect(src).not.toContain("canViewExpenseRow");
  });

  it("status labels follow the existing expense statuses", () => {
    expect(cashExpenseStatusLabel("en", pending)).toBe("Pending");
    expect(cashExpenseStatusLabel("en", rejected)).toBe("Rejected");
    expect(cashExpenseStatusLabel("en", lunch)).toBe("Approved");
  });

  it("keeps pending and rejected rows visible and out of the approved total", () => {
    const selected = [lunch, pending, rejected];
    const model = buildCashExpenseListDocument(input({ expenses: selected }));
    const categories = model.sections[1]?.table?.records.map((row) => row[1]);
    expect(categories).toEqual(["Lunch", "Airtime", "Water"]);
    expect(model.sections[1]?.table?.records.map((row) => row[4])).toEqual([
      "Approved",
      "Pending",
      "Rejected",
    ]);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(8_000));
  });

  it("treats a missing approvalStatus as approved", () => {
    const legacy = expense({
      id: "e-legacy",
      amountUgx: 4_000,
      category: "Rent",
    });
    delete legacy.approvalStatus;
    const model = buildCashExpenseListDocument(input({ expenses: [legacy] }));
    expect(model.sections[1]?.table?.records[0]?.[4]).toBe("Approved");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(4_000));
    expect(sumDrawerExpenseAmounts([legacy])).toBe(4_000);
  });

  it("uses paidOn as the day boundary and excludes deleted rows", () => {
    const selected = selectVisibleExpensesForDay(
      [lunch, otherDay, deleted],
      DAY,
      "owner",
      "owner-1",
    );
    const model = buildCashExpenseListDocument(input({ expenses: selected }));
    expect(selected.map((e) => e.id)).toEqual(["e-lunch"]);
    expect(JSON.stringify(model)).not.toContain("50,000");
    expect(JSON.stringify(model)).not.toContain("e-deleted");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(8_000));
  });
});
