import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../../offline/syncEngine";
import { usePosStore } from "../../store/usePosStore";
import { openTestShift } from "../../test/shiftTestSetup";
import type { Customer, Product } from "../../types";

/**
 * Phase 1 — a loyalty member must be attachable to a sale on EVERY payment
 * method, not just credit.
 *
 * `sales.customer_id` stays the one linkage the loyalty engine keys on, so
 * these tests assert the real finalize path carries it for cash, ATM, mobile
 * money and credit alike. The engine itself is untouched and unmocked here:
 * awarding is the database's job at sync time.
 */

const ROOT = process.cwd();
const CHECKOUT_PANEL = readFileSync(
  resolve(ROOT, "src/components/pos/PosCheckoutPanel.tsx"),
  "utf8",
);
const DESKTOP_DOCK = readFileSync(
  resolve(ROOT, "src/components/pos/PosDesktopCatalogCheckoutDock.tsx"),
  "utf8",
);

const CUSTOMER_ID = "cccccccc-0000-4000-8000-000000000001";

const coke = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Coke",
  sellingMode: "unit",
  baseUnit: "bottle",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 1_200,
  stockOnHand: 500,
  minimumStockAlert: 0,
  category: "Drinks",
  sku: "",
  updatedAt: "2026-09-23T08:00:00.000Z",
  version: 1,
} as unknown as Product;

const member = {
  id: CUSTOMER_ID,
  name: "Nakato Sarah",
  phone: "+256700000001",
  createdAt: "2026-09-23T08:00:00.000Z",
  updatedAt: "2026-09-23T08:00:00.000Z",
} as unknown as Customer;

const st = () => usePosStore.getState();

function primeCart() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [{ ...coke }],
    customers: [{ ...member }],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    returnRecords: [],
    auditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftInput: null,
    draftPaymentMethod: "cash",
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
  });
  expect(openTestShift().ok).toBe(true);
  usePosStore.setState({
    draftLines: [
      {
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        productId: coke.id,
        name: "Coke",
        inputMode: "quantity",
        quantity: 10,
        unitPriceUgx: 2_000,
        unitCostUgx: 1_200,
        lineTotalUgx: 20_000,
        estimatedProfitUgx: 0,
        updatedAt: "2026-09-23T08:00:00.000Z",
      },
    ],
  });
}

describe("a loyalty member attaches to the sale on every payment method", () => {
  beforeEach(() => {
    vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["cash", 0],
    ["atm", 0],
    ["mobile_money", 0],
  ] as const)(
    "%s: the finalized sale carries customerId, so the server can award",
    (paymentMethod, debtUgx) => {
      primeCart();

      // What the scan (or the picker) does: attach the member to the draft.
      st().setDraftSaleCustomer({
        customerId: CUSTOMER_ID,
        customerName: member.name,
        customerPhone: "+256700000001",
      });
      expect(st().draftSaleCustomerId).toBe(CUSTOMER_ID);

      const result = st().finalizeDraftSale({
        debtUgx,
        customerId: st().draftSaleCustomerId,
        customerName: st().draftSaleCustomerName,
        paymentMethod,
      } as never);
      expect(result).toMatchObject({ ok: true });

      const sale = st().sales[0]!;
      expect(sale.customerId).toBe(CUSTOMER_ID);
      expect(sale.paymentMethod).toBe(paymentMethod);
      expect(sale.totalUgx).toBe(20_000);
      expect(sale.debtUgx).toBe(0);
    },
  );

  it("credit: attachment still works, and the debt linkage is unchanged", () => {
    primeCart();
    st().setDraftSaleCustomer({
      customerId: CUSTOMER_ID,
      customerName: member.name,
      customerPhone: "+256700000001",
    });

    const result = st().finalizeDraftSale({
      debtUgx: 20_000,
      customerId: CUSTOMER_ID,
      customerName: member.name,
      paymentMethod: "credit",
    } as never);
    expect(result).toMatchObject({ ok: true });

    const sale = st().sales[0]!;
    expect(sale.customerId).toBe(CUSTOMER_ID);
    expect(sale.debtUgx).toBe(20_000);
  });

  it("a cash sale with no member still completes — loyalty never blocks a sale", () => {
    primeCart();

    const result = st().finalizeDraftSale({
      debtUgx: 0,
      customerId: null,
      paymentMethod: "cash",
    } as never);
    expect(result).toMatchObject({ ok: true });

    const sale = st().sales[0]!;
    expect(sale.customerId).toBeNull();
    expect(sale.totalUgx).toBe(20_000);
  });

  it("detaching clears the linkage, so the next sale does not inherit the member", () => {
    primeCart();
    st().setDraftSaleCustomer({ customerId: CUSTOMER_ID, customerName: member.name });
    expect(st().draftSaleCustomerId).toBe(CUSTOMER_ID);

    st().setDraftSaleCustomer({ customerId: "", customerName: "", customerPhone: "" });
    expect(st().draftSaleCustomerId).toBe("");

    const result = st().finalizeDraftSale({
      debtUgx: 0,
      customerId: st().draftSaleCustomerId || null,
      paymentMethod: "cash",
    } as never);
    expect(result).toMatchObject({ ok: true });
    expect(st().sales[0]!.customerId).toBeNull();
  });
});

describe("the checkout surfaces render loyalty outside any payment-method branch", () => {
  it("PaymentBlock renders the row before the method-specific blocks", () => {
    const loyaltyIdx = CHECKOUT_PANEL.indexOf("{loyaltyBadge}");
    const creditBranchIdx = CHECKOUT_PANEL.indexOf('paymentMethod === "credit" && dockMode');
    expect(loyaltyIdx).toBeGreaterThan(-1);
    expect(creditBranchIdx).toBeGreaterThan(-1);
    expect(loyaltyIdx).toBeLessThan(creditBranchIdx);
  });

  it("the loyalty row is no longer nested inside the credit-only panel", () => {
    // CreditCatalogDockPanel used to be the only place it rendered.
    expect(CHECKOUT_PANEL).not.toMatch(/paymentCreditCustomerDetails[\s\S]{0,120}\{loyaltyBadge\}/);
  });

  it("the desktop catalog dock renders it for every method, not only credit", () => {
    const loyaltyIdx = DESKTOP_DOCK.indexOf("{loyaltyBadge}");
    const creditIdx = DESKTOP_DOCK.indexOf("{isCredit ? (");
    expect(loyaltyIdx).toBeGreaterThan(-1);
    expect(loyaltyIdx).toBeLessThan(creditIdx);
  });
});
