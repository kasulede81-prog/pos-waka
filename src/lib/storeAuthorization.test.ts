import { describe, expect, it } from "vitest";
import type { UserRole } from "../types";
import {
  STORE_ACTION_PERMISSIONS,
  checkStorePermission,
  roleMayPerformStoreAction,
  type SensitiveStoreAction,
} from "./storeAuthorization";
import { hasPermission } from "./permissions";
import type { SessionActor } from "./sessionActor";

const ROLES: UserRole[] = ["owner", "manager", "cashier", "stock_keeper", "supervisor", "waiter"];

function actor(role: UserRole): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

const SENSITIVE_ACTIONS: SensitiveStoreAction[] = [
  "finalizeDraftSale",
  "adjustStock",
  "updateProduct",
  "addProduct",
  "addDebtPayment",
  "addCashExpense",
  "recordPurchase",
  "backupRestore",
  "removeProduct",
  "recordDayClose",
  "permanentlyDeleteArchived",
];

describe("storeAuthorization — permission matrix", () => {
  it("every sensitive action maps to a permission", () => {
    for (const action of SENSITIVE_ACTIONS) {
      expect(STORE_ACTION_PERMISSIONS[action]).toBeTruthy();
    }
  });

  it("owner may perform all sensitive actions", () => {
    for (const action of SENSITIVE_ACTIONS) {
      expect(roleMayPerformStoreAction("owner", action)).toBe(true);
    }
  });

  it("cashier may sell and manage customer credit but not stock, products, or backup", () => {
    expect(roleMayPerformStoreAction("cashier", "finalizeDraftSale")).toBe(true);
    expect(roleMayPerformStoreAction("cashier", "addCashExpense")).toBe(true);
    expect(roleMayPerformStoreAction("cashier", "addDebtPayment")).toBe(true);
    expect(roleMayPerformStoreAction("cashier", "adjustStock")).toBe(false);
    expect(roleMayPerformStoreAction("cashier", "updateProduct")).toBe(false);
    expect(roleMayPerformStoreAction("cashier", "recordPurchase")).toBe(false);
    expect(roleMayPerformStoreAction("cashier", "backupRestore")).toBe(false);
    expect(roleMayPerformStoreAction("cashier", "removeProduct")).toBe(false);
  });

  it("stock keeper may adjust stock and purchase but not sell or restore", () => {
    expect(roleMayPerformStoreAction("stock_keeper", "adjustStock")).toBe(true);
    expect(roleMayPerformStoreAction("stock_keeper", "recordPurchase")).toBe(true);
    expect(roleMayPerformStoreAction("stock_keeper", "finalizeDraftSale")).toBe(false);
    expect(roleMayPerformStoreAction("stock_keeper", "backupRestore")).toBe(false);
  });

  it("waiter may sell only — no back-office mutations", () => {
    expect(roleMayPerformStoreAction("waiter", "finalizeDraftSale")).toBe(true);
    expect(roleMayPerformStoreAction("waiter", "adjustStock")).toBe(false);
    expect(roleMayPerformStoreAction("waiter", "addDebtPayment")).toBe(false);
    expect(roleMayPerformStoreAction("waiter", "backupRestore")).toBe(false);
  });

  for (const role of ROLES) {
    for (const action of SENSITIVE_ACTIONS) {
      it(`matrix consistency: ${role} / ${action}`, () => {
        const perm = STORE_ACTION_PERMISSIONS[action];
        expect(roleMayPerformStoreAction(role, action)).toBe(hasPermission(role, perm));
      });
    }
  }
});

describe("storeAuthorization — checkStorePermission", () => {
  it("denies when actor is null", () => {
    expect(checkStorePermission(null, "stock.adjust")).toEqual({ ok: false, errorKey: "noSelection" });
  });

  it("denies cashier stock adjustment", () => {
    expect(checkStorePermission(actor("cashier"), "stock.adjust")).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("allows manager stock adjustment", () => {
    expect(checkStorePermission(actor("manager"), "stock.adjust")).toEqual({ ok: true });
  });
});

describe("storeAuthorization — cashier regression", () => {
  const cashier = actor("cashier");

  it("cashier -> stock adjustment denied", () => {
    expect(checkStorePermission(cashier, "stock.adjust").ok).toBe(false);
  });

  it("cashier -> debt payment allowed", () => {
    expect(checkStorePermission(cashier, "customers.debt").ok).toBe(true);
  });

  it("cashier -> product edit denied", () => {
    expect(checkStorePermission(cashier, "stock.adjust").ok).toBe(false);
    expect(checkStorePermission(cashier, "products.add").ok).toBe(false);
  });

  it("cashier -> backup restore denied", () => {
    expect(checkStorePermission(cashier, "settings.shop").ok).toBe(false);
  });
});
