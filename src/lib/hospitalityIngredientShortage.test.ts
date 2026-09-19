/**
 * Round 3 / P5 — one ingredient-shortage policy for order-taking AND finalize.
 *
 * Adding a dish honoured the configured policy (warn / block / manager_override / allow-negative) but
 * finalize hard-blocked every shortage, so a bill the policy had accepted could never be settled.
 * Both steps now share `decideIngredientShortage`. A permitted shortfall never pushes stock below
 * zero (the deduction floors at the shelf quantity) and is written to the audit trail.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { IngredientStockPolicy, Product, SaleLine, UserRole } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { decideIngredientShortage } from "./hospitalityHardware";

const BUN = "bun";
const BURGER = "burger";

const bun: Product = {
  id: BUN,
  name: "Bun",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 500,
  costPricePerUnitUgx: 400,
  stockOnHand: 3,
  minimumStockAlert: 0,
  category: "Ingredients",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
  menu: { productKind: "ingredient" },
};

const burger: Product = {
  id: BURGER,
  name: "Burger",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 15_000,
  costPricePerUnitUgx: 0,
  stockOnHand: 0,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
  menu: {
    productKind: "finished_menu",
    prepMode: "made_to_order",
    recipe: { yieldQty: 1, lines: [{ ingredientProductId: BUN, quantityBase: 2, unitLabel: "pcs" }] },
    modifierGroups: [],
    variants: [],
  },
};

const line = (qty: number): SaleLine => ({
  id: "l1",
  productId: BURGER,
  name: "Burger",
  inputMode: "quantity",
  quantity: qty,
  unitPriceUgx: 15_000,
  unitCostUgx: 800,
  lineTotalUgx: 15_000 * qty,
  estimatedProfitUgx: (15_000 - 800) * qty,
  updatedAt: "2026-09-17T08:05:00.000Z",
});

const st = () => usePosStore.getState();
const stockOf = (id: string) => st().products.find((p) => p.id === id)!.stockOnHand;

function seed(opts: { policy: IngredientStockPolicy; allowNegativeInventory?: boolean; role?: UserRole; lines?: SaleLine[] }) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "u1", role: opts.role ?? "owner", displayName: "Actor" },
    products: [{ ...bun }, { ...burger }],
    customers: [],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    returnRecords: [],
    auditLogs: [],
    archivedAuditLogs: [],
    draftLines: opts.lines ?? [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftInput: null,
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
    draftPaymentMethod: "cash",
    preferences: {
      ...st().preferences,
      hospitalityIngredientPolicy: { policy: opts.policy, allowNegativeInventory: opts.allowNegativeInventory ?? false },
    },
  });
  // shifts need an owner-capable actor to open, then the role under test takes over
  usePosStore.setState({ sessionActor: { userId: "u1", role: "owner", displayName: "Actor" } });
  expect(openTestShift().ok).toBe(true);
  usePosStore.setState({ sessionActor: { userId: "u1", role: opts.role ?? "owner", displayName: "Actor" } });
}

const finalize = () => st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
const shortageAudits = () => st().auditLogs.filter((a) => a.action === "hospitality_ingredient_shortage_sale");

describe("decideIngredientShortage (pure)", () => {
  const shortage = [{ ingredientProductId: BUN, ingredientName: "Bun", requiredBase: 4, availableBase: 3, unitLabel: "pcs" }];
  const prefs = (policy: IngredientStockPolicy, allowNegativeInventory = false) =>
    ({ hospitalityIngredientPolicy: { policy, allowNegativeInventory } }) as never;
  it("passes when there is no shortage", () => {
    expect(decideIngredientShortage({ prefs: prefs("block"), shortages: [], role: "cashier" })).toEqual({ allow: true, shortfall: false });
  });
  it("warn and allow-negative let a shortfall through", () => {
    expect(decideIngredientShortage({ prefs: prefs("warn"), shortages: shortage, role: "cashier" })).toEqual({ allow: true, shortfall: true });
    expect(decideIngredientShortage({ prefs: prefs("block", true), shortages: shortage, role: "cashier" })).toEqual({ allow: true, shortfall: true });
  });
  it("block never lets it through, even for an owner", () => {
    expect(decideIngredientShortage({ prefs: prefs("block"), shortages: shortage, role: "owner", managerOverride: true })).toEqual({
      allow: false,
      errorKey: "ingredientShortage",
    });
  });
  it("manager_override needs an owner/manager", () => {
    expect(decideIngredientShortage({ prefs: prefs("manager_override"), shortages: shortage, role: "cashier" })).toEqual({
      allow: false,
      errorKey: "ingredientShortageOverride",
    });
    expect(decideIngredientShortage({ prefs: prefs("manager_override"), shortages: shortage, role: "manager" }).allow).toBe(true);
    expect(decideIngredientShortage({ prefs: prefs("manager_override"), shortages: shortage, role: "cashier", managerOverride: true }).allow).toBe(true);
  });
});

describe("finalize honours the configured ingredient policy", () => {
  it("warn: a bill the policy accepted can be settled; stock floors at 0 and the shortfall is audited", () => {
    seed({ policy: "warn", lines: [line(2)] }); // needs 4 buns, 3 on the shelf
    const res = finalize();
    expect(res.ok).toBe(true);
    expect(stockOf(BUN)).toBe(0); // never negative
    const moves = st().stockMovements.filter((m) => m.productId === BUN);
    expect(moves.map((m) => m.deltaBaseUnits)).toEqual([-3]); // ledger = what actually left the shelf
    expect(st().sales.filter((s) => s.status === "completed")).toHaveLength(1);
    const audits = shortageAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload.shortages).toEqual([
      { ingredientProductId: BUN, ingredientName: "Bun", requiredBase: 4, availableBase: 3 },
    ]);
  });

  it("block: finalize is refused with no side effects", () => {
    seed({ policy: "block", lines: [line(2)] });
    const res = finalize();
    expect(res).toMatchObject({ ok: false, errorKey: "ingredientShortage" });
    expect(stockOf(BUN)).toBe(3);
    expect(st().sales).toHaveLength(0);
    expect(st().stockMovements).toHaveLength(0);
    expect(shortageAudits()).toHaveLength(0);
  });

  it("block + allowNegativeInventory: the merchant's explicit choice wins", () => {
    seed({ policy: "block", allowNegativeInventory: true, lines: [line(2)] });
    expect(finalize().ok).toBe(true);
    expect(stockOf(BUN)).toBe(0);
    expect(shortageAudits()).toHaveLength(1);
  });

  it("manager_override: a cashier is refused, a manager can settle", () => {
    seed({ policy: "manager_override", role: "cashier", lines: [line(2)] });
    expect(finalize()).toMatchObject({ ok: false, errorKey: "ingredientShortageOverride" });
    expect(st().sales).toHaveLength(0);
    expect(stockOf(BUN)).toBe(3);

    usePosStore.setState({ sessionActor: { userId: "u1", role: "manager", displayName: "Boss" } });
    expect(finalize().ok).toBe(true);
    expect(stockOf(BUN)).toBe(0);
  });

  it("no shortage: no shortfall audit, exact deduction", () => {
    seed({ policy: "warn", lines: [line(1)] }); // 2 buns of 3
    expect(finalize().ok).toBe(true);
    expect(stockOf(BUN)).toBe(1);
    expect(shortageAudits()).toHaveLength(0);
  });
});

describe("order-taking and finalize agree", () => {
  beforeEach(() => seed({ policy: "warn" }));

  it("warn: adding the dish succeeds AND the bill can then be finalized", () => {
    const add = st().addHospitalityDraftLine({ product: burger, quantity: 2 });
    expect(add.ok).toBe(true);
    expect(finalize().ok).toBe(true);
  });

  it("block: the dish is refused at order-taking, so no stranded bill can exist", () => {
    seed({ policy: "block" });
    const add = st().addHospitalityDraftLine({ product: burger, quantity: 2 });
    expect(add).toMatchObject({ ok: false, errorKey: "ingredientShortage" });
    expect(st().draftLines).toHaveLength(0);
  });
});
