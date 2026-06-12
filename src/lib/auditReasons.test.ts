import { describe, expect, it, beforeEach } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { Product } from "../types";
import {
  AUDIT_REASON_MIN_LEN,
  auditReasonErrorKey,
  normalizeAuditReason,
  validateAuditReason,
} from "./auditReasons";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseProduct: Product = {
  id: PRODUCT_ID,
  name: "Cola",
  sellingPricePerUnitUgx: 1_000,
  costPricePerUnitUgx: 100,
  stockOnHand: 10,
  baseUnit: "pcs",
  sellingMode: "unit",
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-05-31T09:00:00.000Z",
  version: 1,
};

describe("auditReasons", () => {
  it("validateAuditReason requires minimum length", () => {
    expect(AUDIT_REASON_MIN_LEN).toBe(3);
    expect(validateAuditReason("")).toBe(false);
    expect(validateAuditReason("ab")).toBe(false);
    expect(validateAuditReason("abc")).toBe(true);
    expect(validateAuditReason("  counted stock  ")).toBe(true);
  });

  it("normalizeAuditReason trims whitespace", () => {
    expect(normalizeAuditReason("  damaged goods  ")).toBe("damaged goods");
  });

  it("auditReasonErrorKey is stable", () => {
    expect(auditReasonErrorKey()).toBe("auditReasonRequired");
  });
});

describe("usePosStore — mandatory audit reasons", () => {
  beforeEach(() => {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      products: [baseProduct],
      auditLogs: [],
      cashExpenses: [
        {
          id: "exp-1",
          category: "transport",
          amountUgx: 5_000,
          description: "",
          paidOn: "2026-06-01",
          createdAt: "2026-06-01T10:00:00.000Z",
          createdByUserId: "owner-1",
          pendingSync: false,
        },
      ],
    });
  });

  it("removeProduct rejects missing reason", () => {
    const r = usePosStore.getState().removeProduct(PRODUCT_ID, "");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("auditReasonRequired");
    expect(usePosStore.getState().products).toHaveLength(1);
  });

  it("removeProduct stores reason in audit payload", () => {
    const r = usePosStore.getState().removeProduct(PRODUCT_ID, "discontinued item");
    expect(r.ok).toBe(true);
    const log = usePosStore.getState().auditLogs.find((a) => a.action === "product_remove");
    expect(log?.payload.reason).toBe("discontinued item");
  });

  it("updateProduct rejects price change without reason", () => {
    const r = usePosStore.getState().updateProduct(PRODUCT_ID, { sellingPricePerUnitUgx: 2_000 });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("auditReasonRequired");
    expect(usePosStore.getState().products[0]!.sellingPricePerUnitUgx).toBe(1_000);
  });

  it("updateProduct accepts price change with reason", () => {
    const r = usePosStore.getState().updateProduct(
      PRODUCT_ID,
      { sellingPricePerUnitUgx: 2_000 },
      { auditReason: "supplier raised cost" },
    );
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().products[0]!.sellingPricePerUnitUgx).toBe(2_000);
    const priceLog = usePosStore.getState().auditLogs.find((a) => a.action === "price_change");
    expect(priceLog?.payload.reason).toBe("supplier raised cost");
  });

  it("adjustStock rejects short reason", () => {
    usePosStore.getState().adjustStock(PRODUCT_ID, -1, "ok");
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(10);
  });

  it("voidCashExpense requires reason", () => {
    const r = usePosStore.getState().voidCashExpense("exp-1", "no");
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("auditReasonRequired");
  });
});
