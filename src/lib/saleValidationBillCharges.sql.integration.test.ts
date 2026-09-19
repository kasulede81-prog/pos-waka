/**
 * F1 — the canonical sale validator understands the bill charges the client records.
 *
 * finalizeDraftSale records total = (subtotal - discount) + serviceCharge + tip + exclusive tax, and pushes the
 * three charges in sale.metadata (serviceChargeUgx / tipUgx / taxUgx). The old validator required
 * total = subtotal - discount, so a hospitality bill with any of them was rejected before a single row was
 * written ('sale_total_mismatch'). Migration 20260919130000 replaces ONLY that function.
 *
 * Real SQL: the OLD validator is created from migration 120, the NEW one by applying the new migration on top
 * of it (exactly what production will do). The same inputs are run through both.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as syncEngine from "../offline/syncEngine";
import type { Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { buildSalePushPayload } from "../offline/cloudSync";

const dir = join(process.cwd(), "supabase", "migrations");
const NEW_MIGRATION = "20260919130000_sale_validation_bill_charges.sql";
const SHOP = "00000000-0000-4000-8000-000000000000";

function oldValidatorSql(): string {
  const src = readFileSync(join(dir, "120_sale_price_validation.sql"), "utf8");
  const s = src.indexOf("create or replace function public.validate_sale_push_financials");
  return src.slice(s, src.indexOf("$$;", s) + 3);
}
const newMigrationSql = () => readFileSync(join(dir, NEW_MIGRATION), "utf8");

type Sale = Record<string, unknown>;
type Line = Record<string, unknown>;
type Verdict = { ok: boolean; error?: string; field?: string };

const line = (total = 100_000, extra: Line = {}): Line => ({ quantity: 1, unit_price_ugx: total, line_discount_ugx: 0, line_total_ugx: total, line_input_mode: "quantity", ...extra });

/** A sale header the way buildSalePushPayload writes it: `total` already includes the charges. */
function sale(o: { subtotal?: number; discount?: number; total: number; cash?: number; debt?: number; meta?: Record<string, unknown> | null | string }): Sale {
  const total = o.total;
  const debt = o.debt ?? 0;
  return {
    subtotal_ugx: o.subtotal ?? 100_000,
    discount_ugx: o.discount ?? 0,
    tax_ugx: 0,
    total_ugx: total,
    cash_amount_ugx: o.cash ?? total - debt,
    debt_amount_ugx: debt,
    ...(o.meta === undefined ? {} : { metadata: o.meta }),
  };
}
const charges = (c: { service?: number | null; tip?: number | null; tax?: number | null }) => ({ serviceChargeUgx: c.service ?? null, tipUgx: c.tip ?? null, taxUgx: c.tax ?? null });

let oldDb: PGlite;
let newDb: PGlite;
const verdict = async (db: PGlite, s: Sale | null, lines: Line[] | null = [line()]) =>
  (await db.query<{ r: Verdict }>("select public.validate_sale_push_financials($1::uuid, $2::jsonb, $3::jsonb) as r", [SHOP, JSON.stringify(s), JSON.stringify(lines)])).rows[0]!.r;
const config = async (db: PGlite) =>
  (await db.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] | null; args: string; ret: string }>(
    `select prosecdef, provolatile, proconfig, pg_get_function_identity_arguments(oid) as args, pg_get_function_result(oid) as ret from pg_proc where proname = 'validate_sale_push_financials'`,
  )).rows[0]!;

beforeAll(async () => {
  oldDb = new PGlite();
  await oldDb.exec(oldValidatorSql());
  newDb = new PGlite();
  await newDb.exec(oldValidatorSql());
  await newDb.exec(newMigrationSql());
}, 60_000);
afterAll(async () => {
  await oldDb.close();
  await newDb.close();
});

describe("the migration replaces only the validator, and keeps its configuration", () => {
  it("defines exactly one function and runs no other DDL/DML", () => {
    const sql = newMigrationSql().replace(/--.*$/gm, "");
    expect(sql.match(/create or replace function/gi)).toHaveLength(1);
    expect(sql).toMatch(/create or replace function public\.validate_sale_push_financials\s*\(/i);
    for (const forbidden of [/\bdrop\b/i, /\balter\b/i, /\bcreate table\b/i, /\binsert\b/i, /\bupdate\b/i, /\bdelete\b/i, /\bgrant\b/i, /\brevoke\b/i]) expect(sql).not.toMatch(forbidden);
  });

  it("signature, return type, security definer, volatility and search_path are unchanged", async () => {
    const before = await config(oldDb);
    const after = await config(newDb);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ prosecdef: true, provolatile: "v", proconfig: ["search_path=public"], ret: "jsonb" });
  });
});

describe("the OLD validator (the defect, for the record)", () => {
  it.each([
    ["service charge", 110_000, charges({ service: 10_000 })],
    ["tip", 105_000, charges({ tip: 5_000 })],
    ["exclusive tax", 118_000, charges({ tax: 18_000 })],
  ])("rejects a legitimate sale with a %s", async (_n, total, meta) => {
    expect(await verdict(oldDb, sale({ total, meta }))).toEqual({ ok: false, error: "sale_total_mismatch" });
  });
});

describe("NEW validator — valid: expected total == persisted total", () => {
  const cases: Array<[string, Sale]> = [
    ["1. normal Retail sale (no metadata at all)", sale({ total: 100_000 })],
    ["2. hospitality sale, no charges (all null)", sale({ total: 100_000, meta: charges({}) })],
    ["2b. metadata present but without the charge keys", sale({ total: 100_000, meta: { paymentMethod: "cash", billPayments: null } })],
    ["3. + service charge", sale({ total: 110_000, meta: charges({ service: 10_000 }) })],
    ["4. + tip", sale({ total: 105_000, meta: charges({ tip: 5_000 }) })],
    ["5. + exclusive tax", sale({ total: 118_000, meta: charges({ tax: 18_000 }) })],
    ["6. service + tip", sale({ total: 115_000, meta: charges({ service: 10_000, tip: 5_000 }) })],
    ["7. service + tax", sale({ total: 128_000, meta: charges({ service: 10_000, tax: 18_000 }) })],
    ["8. tip + tax", sale({ total: 123_000, meta: charges({ tip: 5_000, tax: 18_000 }) })],
    ["9. service + tip + tax", sale({ total: 133_000, meta: charges({ service: 10_000, tip: 5_000, tax: 18_000 }) })],
    ["10. discount + service charge", sale({ discount: 10_000, total: 100_000, meta: charges({ service: 10_000 }) })],
    ["11. discount + tip", sale({ discount: 10_000, total: 95_000, meta: charges({ tip: 5_000 }) })],
    ["12. discount + tax", sale({ discount: 10_000, total: 108_000, meta: charges({ tax: 18_000 }) })],
    ["13. discount + all charges", sale({ discount: 10_000, total: 123_000, meta: charges({ service: 10_000, tip: 5_000, tax: 18_000 }) })],
    ["14. credit sale + charges (debt covers the charges too)", sale({ total: 133_000, cash: 33_000, debt: 100_000, meta: charges({ service: 10_000, tip: 5_000, tax: 18_000 }) })],
    ["14b. fully on credit + service charge", sale({ total: 110_000, cash: 0, debt: 110_000, meta: charges({ service: 10_000 }) })],
    ["15. zero charges given as explicit 0", sale({ total: 100_000, meta: { serviceChargeUgx: 0, tipUgx: 0, taxUgx: 0 } })],
    ["the +/-1 rounding tolerance still applies with charges", sale({ total: 110_001, meta: charges({ service: 10_000 }) })],
    ["a discount larger than the subtotal floors at 0, charges still added", sale({ discount: 150_000, total: 10_000, cash: 10_000, meta: charges({ service: 10_000 }) })],
  ];
  it.each(cases)("%s", async (_name, s) => {
    expect(await verdict(newDb, s)).toEqual({ ok: true });
  });
});

describe("NEW validator — invalid: persisted total != expected total", () => {
  it("16. negative service charge is rejected (it must not be able to balance a wrong total)", async () => {
    expect(await verdict(newDb, sale({ total: 90_000, meta: charges({ service: -10_000 }) }))).toEqual({ ok: false, error: "negative_sale_amount" });
  });
  it("17. negative tip is rejected", async () => {
    expect(await verdict(newDb, sale({ total: 95_000, meta: charges({ tip: -5_000 }) }))).toEqual({ ok: false, error: "negative_sale_amount" });
  });
  it("18. negative tax is rejected", async () => {
    expect(await verdict(newDb, sale({ total: 82_000, meta: charges({ tax: -18_000 }) }))).toEqual({ ok: false, error: "negative_sale_amount" });
  });
  it.each([
    ["total ignores the charge that the metadata declares (charge recorded, not added)", sale({ total: 100_000, meta: charges({ service: 10_000 }) })],
    ["total adds a charge the metadata does not declare", sale({ total: 110_000, meta: charges({}) })],
    ["total adds a charge on a metadata-less sale", sale({ total: 110_000 })],
    ["19. obviously absurd total", sale({ total: 999_999_999, meta: charges({ service: 10_000 }) })],
    ["19b. total is zero although a charge exists", sale({ total: 0, cash: 0, meta: charges({ service: 10_000 }) })],
    ["19c. total off by more than the tolerance", sale({ total: 110_002, meta: charges({ service: 10_000 }) })],
    ["19d. the charges counted twice", sale({ total: 120_000, meta: charges({ service: 10_000 }) })],
    ["19e. discount forgotten while a charge is present", sale({ discount: 10_000, total: 110_000, meta: charges({ service: 10_000 }) })],
  ])("%s", async (_n, s) => {
    expect(await verdict(newDb, s)).toEqual({ ok: false, error: "sale_total_mismatch" });
  });
  it("cash + debt must still equal the total when charges are present", async () => {
    expect(await verdict(newDb, sale({ total: 110_000, cash: 50_000, debt: 50_000, meta: charges({ service: 10_000 }) }))).toEqual({ ok: false, error: "payment_total_mismatch" });
  });
  it.each([
    ["a string amount", { serviceChargeUgx: "10000" }],
    ["a boolean", { tipUgx: true }],
    ["an object", { taxUgx: { v: 1 } }],
    ["an array", { serviceChargeUgx: [10_000] }],
  ])("a charge that is not a number is rejected (%s)", async (_n, meta) => {
    const field = Object.keys(meta)[0];
    expect(await verdict(newDb, sale({ total: 100_000, meta }))).toEqual({ ok: false, error: "invalid_bill_charge", field });
  });
  it("metadata that is not an object is ignored (no charges), never trusted", async () => {
    expect(await verdict(newDb, sale({ total: 100_000, meta: "x" }))).toEqual({ ok: true });
    expect(await verdict(newDb, sale({ total: 110_000, meta: "x" }))).toEqual({ ok: false, error: "sale_total_mismatch" });
  });
});

describe("20. existing Retail validation is unchanged (old and new give the identical answer)", () => {
  const retail: Array<[string, Sale | null, Line[] | null]> = [
    ["plain retail sale", sale({ total: 100_000 }), [line()]],
    ["retail with discount", sale({ discount: 5_000, total: 95_000 }), [line()]],
    ["retail with a line discount", sale({ subtotal: 90_000, total: 90_000 }), [line(90_000, { unit_price_ugx: 100_000, line_discount_ugx: 10_000 })]],
    ["several lines", sale({ subtotal: 30_000, total: 30_000 }), [line(10_000), line(20_000)]],
    ["money-mode line", sale({ subtotal: 5_000, total: 5_000 }), [{ ...line(5_000), line_input_mode: "money", money_amount_ugx: 5_000 }]],
    ["money line total mismatch", sale({ subtotal: 5_000, total: 5_000 }), [{ ...line(5_000), line_input_mode: "money", money_amount_ugx: 4_000 }]],
    ["fractional quantity", sale({ subtotal: 5_000, total: 5_000 }), [{ quantity: 2.5, unit_price_ugx: 2_000, line_discount_ugx: 0, line_total_ugx: 5_000, line_input_mode: "quantity" }]],
    ["line total mismatch", sale({ total: 100_000 }), [line(100_000, { unit_price_ugx: 50_000 })]],
    ["negative line amount", sale({ total: 100_000 }), [line(100_000, { unit_price_ugx: -1 })]],
    ["subtotal mismatch", sale({ subtotal: 90_000, total: 90_000 }), [line()]],
    ["sale total mismatch (no charges)", sale({ total: 90_000 }), [line()]],
    ["sale total within tolerance", sale({ total: 100_001 }), [line()]],
    ["sale total outside tolerance", sale({ total: 100_002 }), [line()]],
    ["payment total mismatch", sale({ total: 100_000, cash: 10_000, debt: 10_000 }), [line()]],
    ["credit sale", sale({ total: 100_000, cash: 40_000, debt: 60_000 }), [line()]],
    ["negative sale amount", sale({ total: 100_000, discount: -1 }), [line()]],
    ["negative cash", sale({ total: 100_000, cash: -1, debt: 100_001 }), [line()]],
    ["empty lines, zero sale", sale({ subtotal: 0, total: 0, cash: 0 }), []],
    ["invalid sale (not an object)", null, [line()]],
    ["invalid lines (not an array)", sale({ total: 100_000 }), null],
    ["tax column set but no metadata (as before: not part of the total)", { ...sale({ total: 100_000 }), tax_ugx: 18_000 }, [line()]],
    ["retail sale that carries unrelated metadata", sale({ total: 100_000, meta: { paymentMethod: "cash", hospitality: true, receiptSeq: 7, billDraft: null } }), [line()]],
  ];
  it.each(retail)("%s", async (_n, s, lines) => {
    const before = await verdict(oldDb, s, lines);
    const after = await verdict(newDb, s, lines);
    expect(after).toEqual(before);
  });
  it("and the answers really are a mix of accepted and rejected", async () => {
    const results = await Promise.all(retail.map(([, s, l]) => verdict(newDb, s, l)));
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(5);
    expect(new Set(results.filter((r) => !r.ok).map((r) => r.error))).toEqual(
      new Set(["money_line_total_mismatch", "line_total_mismatch", "negative_line_amount", "subtotal_mismatch", "sale_total_mismatch", "payment_total_mismatch", "negative_sale_amount", "invalid_sale", "invalid_lines"]),
    );
  });
});

// ── the payload the REAL client builds ─────────────────────────────────────────────────────────────────────────
const coke: Product = { id: "coke", name: "Coke", sellingMode: "unit", baseUnit: "bottle", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 500, minimumStockAlert: 0, category: "Drinks", sku: "", updatedAt: "2026-09-19T08:00:00.000Z", version: 1 };
const st = () => usePosStore.getState();

function checkout(opts: Record<string, unknown>, cartDiscountUgx = 0) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [{ ...coke }],
    customers: [],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    returnRecords: [],
    auditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: cartDiscountUgx,
    activePendingSaleId: null,
    draftInput: null,
    draftPaymentMethod: "cash",
  });
  expect(openTestShift().ok).toBe(true);
  usePosStore.setState({
    draftLines: [{ id: "bbbbbbbb-0000-4000-8000-000000000001", productId: "coke", name: "Coke", inputMode: "quantity", quantity: 50, unitPriceUgx: 2_000, unitCostUgx: 1_200, lineTotalUgx: 100_000, estimatedProfitUgx: 0, updatedAt: "2026-09-19T08:00:00.000Z" }],
  });
  const r = st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash", ...opts } as never);
  expect(r).toMatchObject({ ok: true });
  return st().sales[0]!;
}

describe("the REAL client payload (finalizeDraftSale -> buildSalePushPayload) against the new validator", () => {
  beforeEach(() => {
    vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const scenarios: Array<[string, Record<string, unknown>, number, number]> = [
    ["retail, no extras", {}, 0, 100_000],
    ["service charge", { serviceChargeUgx: 10_000 }, 0, 110_000],
    ["tip", { tipUgx: 5_000 }, 0, 105_000],
    ["exclusive tax", { taxUgx: 18_000 }, 0, 118_000],
    ["service + tip", { serviceChargeUgx: 10_000, tipUgx: 5_000 }, 0, 115_000],
    ["service + tax", { serviceChargeUgx: 10_000, taxUgx: 18_000 }, 0, 128_000],
    ["tip + tax", { tipUgx: 5_000, taxUgx: 18_000 }, 0, 123_000],
    ["service + tip + tax", { serviceChargeUgx: 10_000, tipUgx: 5_000, taxUgx: 18_000 }, 0, 133_000],
    ["cart discount + service charge", { serviceChargeUgx: 10_000 }, 5_000, 105_000],
    ["cart discount + all charges", { serviceChargeUgx: 10_000, tipUgx: 5_000, taxUgx: 18_000 }, 5_000, 128_000],
    ["credit sale + all charges", { serviceChargeUgx: 10_000, tipUgx: 5_000, taxUgx: 18_000, debtUgx: 100_000, customerName: "Debtor One", customerPhone: "0700000001" }, 0, 133_000],
  ];

  it.each(scenarios)("%s: the client's own total is accepted by the new validator (and, with charges, rejected by the old one)", async (_name, opts, discount, expectedTotal) => {
    const s = checkout(opts, discount);
    const p = buildSalePushPayload(s, { shopId: "s", userId: "u" });
    expect(p.sale.total_ugx).toBe(expectedTotal);
    expect(p.sale.cash_amount_ugx + p.sale.debt_amount_ugx).toBe(expectedTotal);
    expect(await verdict(newDb, p.sale as Sale, p.lines as Line[])).toEqual({ ok: true });
    const hasCharge = Boolean(opts.serviceChargeUgx || opts.tipUgx || opts.taxUgx);
    expect((await verdict(oldDb, p.sale as Sale, p.lines as Line[])).ok).toBe(!hasCharge);
  });

  it("a tampered client total (charge silently dropped or inflated) is still rejected", async () => {
    const s = checkout({ serviceChargeUgx: 10_000, tipUgx: 5_000 });
    const p = buildSalePushPayload(s, { shopId: "s", userId: "u" });
    for (const total of [100_000, 105_000, 110_000, 120_000, 115_002]) {
      const bad = { ...p.sale, total_ugx: total, cash_amount_ugx: total } as Sale;
      expect(await verdict(newDb, bad, p.lines as Line[])).toEqual({ ok: false, error: "sale_total_mismatch" });
    }
  });

  it("the fields the validator reads are exactly the ones the client writes", () => {
    const s = checkout({ serviceChargeUgx: 10_000, tipUgx: 5_000, taxUgx: 18_000 });
    const meta = buildSalePushPayload(s, { shopId: "s", userId: "u" }).sale.metadata as Record<string, unknown>;
    expect([meta.serviceChargeUgx, meta.tipUgx, meta.taxUgx]).toEqual([10_000, 5_000, 18_000]);
    const sql = newMigrationSql();
    for (const key of ["serviceChargeUgx", "tipUgx", "taxUgx"]) expect(sql).toContain(`'${key}'`);
    const none = buildSalePushPayload(checkout({}), { shopId: "s", userId: "u" }).sale.metadata as Record<string, unknown>;
    expect([none.serviceChargeUgx, none.tipUgx, none.taxUgx]).toEqual([null, null, null]);
  });
});
