import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Sale } from "../types";
import {
  activityAmountLabel,
  activityKindLabel,
  activityReferenceLabel,
  buildCustomerDebtListDocument,
  buildCustomerDebtListPdfBlob,
  buildCustomerStatementDocument,
  buildCustomerStatementPdfBlob,
  customerContactLabel,
  customerDebtListPeriodLabel,
  customerDebtStatusLabel,
  type CustomerDebtListDocumentInput,
  type CustomerStatementDocumentInput,
} from "./customerAccountDocuments";
import { buildCreditActivityIndex, creditActivityTimelineFromIndex } from "./customerDebtActivity";
import { sumAuthoritativeCustomerDebt, selectCustomersForDebtView } from "./debtsPageView";
import { ugxLabel } from "./reportDocumentModel";

const GENERATED = "2026-09-04T12:00:00.000Z";
const TODAY = "2026-09-04";
const BOUNDS = { fromKey: "2026-09-01", toKey: "2026-09-07", isSingleDay: false };

function customer(partial: Partial<Customer> & Pick<Customer, "id" | "name" | "debtBalanceUgx">): Customer {
  return {
    phone: "",
    location: "Uganda",
    createdAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...partial,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "customerId" | "debtUgx" | "createdAt">): Sale {
  return {
    status: "completed",
    updatedAt: partial.createdAt,
    subtotalUgx: partial.debtUgx,
    totalUgx: partial.debtUgx,
    cashPaidUgx: 0,
    paymentMethod: "credit",
    estimatedProfitUgx: 0,
    lines: [],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

const alice = customer({
  id: "c-alice",
  name: "Alice Namara",
  phone: "+256700111222",
  debtBalanceUgx: 40_000,
});
const bob = customer({
  id: "c-bob",
  name: "Bob Okello",
  phone: "",
  debtBalanceUgx: 0,
});
const carol = customer({
  id: "c-carol",
  name: "Carol Atim",
  phone: "+256700333444",
  debtBalanceUgx: 12_500,
});
const hidden = customer({
  id: "c-hidden",
  name: "Hidden Debtor",
  phone: "+256700999000",
  debtBalanceUgx: 99_000,
});

const sales: Sale[] = [
  sale({ id: "s1", customerId: alice.id, debtUgx: 40_000, createdAt: "2026-08-20T10:00:00.000Z", receiptSeq: 7 }),
  sale({ id: "s2", customerId: carol.id, debtUgx: 12_500, createdAt: "2026-09-03T10:00:00.000Z", receiptSeq: 8 }),
];
const payments: DebtPayment[] = [
  { id: "p1", customerId: alice.id, amountUgx: 10_000, createdAt: "2026-09-04T09:00:00.000Z" },
];

const creditIndex = buildCreditActivityIndex(sales, payments);

function listInput(overrides: Partial<CustomerDebtListDocumentInput> = {}): CustomerDebtListDocumentInput {
  return {
    lang: "en",
    shopName: "Waka Mart",
    shopAddress: "Plot 1 Kampala Road",
    shopPhone: "+256700000000",
    title: "Debts",
    dateFilter: { kind: "preset", preset: "this_week" },
    searchQuery: "",
    quickFilter: "all",
    sortBy: "balance_desc",
    customers: [alice, bob, carol],
    creditIndex,
    generatedAtIso: GENERATED,
    ...overrides,
  };
}

function statementInput(overrides: Partial<CustomerStatementDocumentInput> = {}): CustomerStatementDocumentInput {
  return {
    lang: "en",
    shopName: "Waka Mart",
    shopAddress: "Plot 1 Kampala Road",
    shopPhone: "+256700000000",
    dateFilter: { kind: "preset", preset: "this_week" },
    customer: alice,
    timeline: creditActivityTimelineFromIndex(alice.id, creditIndex),
    generatedAtIso: GENERATED,
    ...overrides,
  };
}

describe("customer debt list document", () => {
  it("includes the selected customers and omits customers not in view", () => {
    const selected = selectCustomersForDebtView({
      customers: [alice, bob, carol],
      searchQuery: "",
      quickFilter: "all",
      index: creditIndex,
      bounds: BOUNDS,
      todayKey: TODAY,
      sortBy: "balance_desc",
    });
    const model = buildCustomerDebtListDocument(listInput({ customers: selected }));
    const names = model.sections[1]?.table?.records.map((row) => row[0]) ?? [];
    expect(names).toEqual(["Alice Namara", "Carol Atim", "Bob Okello"]);
    expect(names.join(" ")).not.toContain("Hidden Debtor");
    expect(JSON.stringify(model)).not.toContain(hidden.phone);
  });

  it("keeps zero-balance customers visible without treating them as owing", () => {
    const model = buildCustomerDebtListDocument(listInput({ customers: [bob] }));
    expect(model.sections[1]?.table?.records[0]).toEqual([
      "Bob Okello",
      "No phone saved",
      "Cleared",
      ugxLabel(0),
    ]);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(0));
  });

  it("uses the same authoritative balances as the debts page", () => {
    const selected = [alice, carol];
    const model = buildCustomerDebtListDocument(listInput({ customers: selected }));
    const balances = model.sections[1]?.table?.records.map((row) => row[3]);
    expect(balances).toEqual([ugxLabel(alice.debtBalanceUgx), ugxLabel(carol.debtBalanceUgx)]);
    expect(sumAuthoritativeCustomerDebt(selected)).toBe(52_500);
  });

  it("aggregates outstanding from the selected dataset only", () => {
    const selected = selectCustomersForDebtView({
      customers: [alice, bob, carol, hidden],
      searchQuery: "",
      quickFilter: "outstanding",
      index: creditIndex,
      bounds: BOUNDS,
      todayKey: TODAY,
      sortBy: "balance_desc",
    });
    const model = buildCustomerDebtListDocument(listInput({ customers: selected, quickFilter: "outstanding" }));
    expect(selected.map((c) => c.id)).toEqual([hidden.id, alice.id, carol.id]);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(
      ugxLabel(sumAuthoritativeCustomerDebt(selected)),
    );
    expect(sumAuthoritativeCustomerDebt(selected)).toBe(151_500);
    expect(sumAuthoritativeCustomerDebt(selected)).not.toBe(sumAuthoritativeCustomerDebt([alice, bob, carol]));
  });

  it("preserves search and filter scope in the printed dataset and period label", () => {
    const selected = selectCustomersForDebtView({
      customers: [alice, bob, carol],
      searchQuery: "carol",
      quickFilter: "all",
      index: creditIndex,
      bounds: BOUNDS,
      todayKey: TODAY,
      sortBy: "name_az",
    });
    const input = listInput({
      customers: selected,
      searchQuery: "carol",
      sortBy: "name_az",
    });
    const model = buildCustomerDebtListDocument(input);
    expect(selected).toHaveLength(1);
    expect(model.sections[1]?.table?.records).toHaveLength(1);
    expect(model.sections[1]?.table?.records[0]?.[0]).toBe("Carol Atim");
    expect(customerDebtListPeriodLabel(input)).toContain("Search: carol");
    expect(model.periodLabel).toContain("Search: carol");
  });

  it("prints an empty filtered result instead of dropping the filter", () => {
    const input = listInput({ customers: [], searchQuery: "zzz-no-match", quickFilter: "overdue" });
    const model = buildCustomerDebtListDocument(input);
    expect(model.periodLabel).toContain("Search: zzz-no-match");
    expect(model.periodLabel).toContain("Overdue");
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(0));
    expect(model.sections[1]?.rows[0]?.label).toBe("No customers match the current filters.");
    expect(model.sections[1]?.table).toBeUndefined();
  });

  it("keeps long customer names in the document model", () => {
    const long = customer({
      id: "c-long",
      name: "Namukasa Aisha Nakato Nalweyiso Wholesale Hardware And General Merchandise",
      phone: "+256701234567",
      debtBalanceUgx: 1_250_000,
    });
    const model = buildCustomerDebtListDocument(listInput({ customers: [long] }));
    expect(model.sections[1]?.table?.records[0]?.[0]).toBe(long.name);
  });

  it("builds a multi-page PDF for a large customer list", async () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      customer({
        id: `c-${i}`,
        name: `Customer ${String(i + 1).padStart(2, "0")} ${"Namara ".repeat(4)}`,
        phone: `+25670${String(i).padStart(7, "0")}`,
        debtBalanceUgx: (i + 1) * 1_000,
      }),
    );
    const input = listInput({ customers: many });
    const model = buildCustomerDebtListDocument(input);
    expect(model.sections[1]?.table?.records).toHaveLength(80);
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(sumAuthoritativeCustomerDebt(many)));
    const pdf = await buildCustomerDebtListPdfBlob(input).text();
    expect(pdf).toContain("Waka Mart");
    expect(pdf).toContain("Plot 1 Kampala Road");
    expect(pdf).toContain("Customer 01");
    expect(pdf).toContain("Customer 80");
    expect(pdf).toMatch(/Page 1 of [2-9]/);
  });
});

describe("customer statement document", () => {
  it("uses the selected customer identity and contact rules", () => {
    const model = buildCustomerStatementDocument(statementInput());
    expect(model.sections[0]?.title).toBe("Alice Namara");
    expect(model.sections[0]?.rows[0]?.value).toBe("+256700111222");
    expect(customerContactLabel("en", bob)).toBe("No phone saved");
    expect(JSON.stringify(model)).not.toContain(hidden.name);
    expect(JSON.stringify(model)).not.toContain(hidden.phone);
  });

  it("prints the existing credit-sale and repayment records", () => {
    const timeline = creditActivityTimelineFromIndex(alice.id, creditIndex);
    const model = buildCustomerStatementDocument(statementInput({ timeline }));
    const records = model.sections[1]?.table?.records ?? [];
    expect(records).toHaveLength(2);
    expect(records.some((row) => row[1] === activityKindLabel("en", { ...timeline[0]!, kind: "credit_sale" }))).toBe(
      true,
    );
    expect(records.some((row) => row[1] === "Credit sale")).toBe(true);
    expect(records.some((row) => row[1] === "Repayment")).toBe(true);
    expect(records.some((row) => row[2] === activityReferenceLabel(timeline.find((e) => e.kind === "credit_sale")!))).toBe(
      true,
    );
    expect(records.some((row) => row[3] === activityAmountLabel(timeline.find((e) => e.kind === "debt_payment")!))).toBe(
      true,
    );
  });

  it("does not invent return or opening-balance rows", () => {
    const model = buildCustomerStatementDocument(statementInput());
    const text = JSON.stringify(model);
    expect(text).not.toMatch(/opening balance/i);
    expect(text).not.toMatch(/return/i);
    expect(model.sections[1]?.table?.records.every((row) => row[1] === "Credit sale" || row[1] === "Repayment")).toBe(
      true,
    );
  });

  it("keeps the stored customer balance as the statement total", () => {
    const filteredTimeline = creditActivityTimelineFromIndex(alice.id, creditIndex).filter(
      (e) => e.kind === "debt_payment",
    );
    const model = buildCustomerStatementDocument(statementInput({ timeline: filteredTimeline }));
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(alice.debtBalanceUgx));
    expect(model.sections[1]?.table?.records).toHaveLength(1);
  });

  it("states when no credit history is available", () => {
    const model = buildCustomerStatementDocument(statementInput({ customer: bob, timeline: [] }));
    expect(model.sections[0]?.rows.find((r) => r.bold)?.value).toBe(ugxLabel(0));
    expect(model.sections[1]?.table).toBeUndefined();
    expect(model.sections[1]?.rows[0]?.label).toBe("No credit sales or repayments yet.");
  });

  it("keeps long history and long descriptions in the model and paginates the PDF", async () => {
    const longName = customer({
      id: "c-long-stmt",
      name: "Nabwire Christine Auma International Distributors And Hardware Supplies Limited",
      phone: "+256702222333",
      debtBalanceUgx: 2_000_000,
    });
    const timeline = Array.from({ length: 60 }, (_, i) => ({
      id: `e-${i}`,
      kind: i % 2 === 0 ? ("credit_sale" as const) : ("debt_payment" as const),
      at: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
      amountUgx: 10_000 + i * 250,
      deltaUgx: i % 2 === 0 ? 10_000 : -5_000,
      receiptSeq: i % 2 === 0 ? i + 1 : undefined,
    }));
    const input = statementInput({ customer: longName, timeline });
    const model = buildCustomerStatementDocument(input);
    expect(model.sections[0]?.title).toBe(longName.name);
    expect(model.sections[1]?.table?.records).toHaveLength(60);
    const pdf = await buildCustomerStatementPdfBlob(input).text();
    expect(pdf).toContain("Nabwire Christine");
    expect(pdf).toContain("Credit sale");
    expect(pdf).toContain("Repayment");
    expect(pdf).toMatch(/Page 1 of [2-9]/);
  });
});

describe("customer document consistency and safety", () => {
  it("status labels follow the existing debts-page rules", () => {
    expect(customerDebtStatusLabel("en", bob, creditIndex)).toBe("Cleared");
    expect(customerDebtStatusLabel("en", alice, creditIndex)).toMatch(/Owes|Overdue|Due soon/);
  });

  it("print and PDF share one document model", () => {
    const list = listInput();
    const statement = statementInput();
    const listModel = buildCustomerDebtListDocument(list);
    const statementModel = buildCustomerStatementDocument(statement);
    expect(buildCustomerDebtListDocument(list)).toEqual(listModel);
    expect(buildCustomerStatementDocument(statement)).toEqual(statementModel);
    expect(listModel.kind).toBe("customer_debt");
    expect(statementModel.kind).toBe("customer_statement");
  });

  it("does not introduce a second debt-accounting formula", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "customerAccountDocuments.ts"), "utf8");
    expect(src).not.toContain("computeExpectedCustomerDebt");
    expect(src).not.toContain("calculateCustomerDebt");
    expect(src).toContain("sumAuthoritativeCustomerDebt");
    expect(src).toContain("customer.debtBalanceUgx");
    expect(src).not.toContain("printSaleReceipt");
    expect(src).not.toContain("wakapos://");
    expect(src).not.toContain("printQueue");
  });
});
