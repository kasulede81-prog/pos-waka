import { describe, expect, it } from "vitest";
import { hasPermission } from "../permissions";
import { hasEffectivePermission } from "../subscriptionEntitlements";
import { canTransitionTransfer, validateTransferLines } from "./stockTransfer";
import { canTransitionPurchaseOrder } from "./enterprisePurchasing";
import { enterprisePermissionsForRole, resolveEnterpriseRoleLabel } from "./enterprisePermissions";
import { endpointsForDomain, internalApiPath } from "./enterpriseApiFoundation";
import { isLegacySingleShopAccountKey, parseShopIdFromAccountKey } from "./shopScope";
import { computeAccountKey } from "../../offline/accountScope";
import { ENTERPRISE_PERFORMANCE_BUDGETS } from "../../types/enterprise";

describe("enterprise foundation — permissions", () => {
  it("owner inherits enterprise HQ permissions", () => {
    expect(hasPermission("owner", "enterprise.access")).toBe(true);
    expect(hasPermission("owner", "enterprise.branches")).toBe(true);
    expect(hasPermission("owner", "enterprise.dashboard")).toBe(true);
  });

  it("cashier lacks enterprise access", () => {
    expect(hasPermission("cashier", "enterprise.access")).toBe(false);
  });

  it("enterprise permissions require business tier", () => {
    const snap = { kind: "remote" as const, row: { plan_code: "starter", status: "active" } };
    expect(hasEffectivePermission("owner", "enterprise.dashboard", snap as never, "supabase")).toBe(false);
  });

  it("maps commercial role labels from POS roles", () => {
    expect(resolveEnterpriseRoleLabel("manager")).toBe("branch_manager");
    expect(resolveEnterpriseRoleLabel("supervisor")).toBe("regional_manager");
  });

  it("enterprisePermissionsForRole extends manager without replacing POS perms", () => {
    const perms = enterprisePermissionsForRole("manager");
    expect(perms).toContain("enterprise.dashboard");
    expect(hasPermission("manager", "pos.sell")).toBe(true);
  });
});

describe("enterprise foundation — stock transfers", () => {
  it("enforces transfer lifecycle", () => {
    expect(canTransitionTransfer("draft", "pending_approval")).toBe(true);
    expect(canTransitionTransfer("draft", "completed")).toBe(false);
  });

  it("validates transfer lines", () => {
    expect(validateTransferLines([]).ok).toBe(false);
    expect(
      validateTransferLines([
        {
          id: "1",
          productId: "p1",
          productName: "Item",
          quantity: 2,
          batchId: null,
          batchNumber: null,
          batchExpiry: null,
          unitCostUgx: 100,
          receivedQuantity: 0,
        },
      ]).ok,
    ).toBe(true);
  });
});

describe("enterprise foundation — purchasing", () => {
  it("PO lifecycle transitions", () => {
    expect(canTransitionPurchaseOrder("pending", "approved")).toBe(true);
    expect(canTransitionPurchaseOrder("received", "pending")).toBe(false);
  });
});

describe("enterprise foundation — internal API registry", () => {
  it("registers sales endpoints", () => {
    const sales = endpointsForDomain("sales");
    expect(sales.length).toBeGreaterThan(0);
    expect(internalApiPath(sales[0]!)).toMatch(/^\/internal\/enterprise\/v1\//);
  });
});

describe("enterprise foundation — shop scope backward compat", () => {
  it("legacy account keys remain unchanged without shop id", () => {
    const legacy = computeAccountKey({ mode: "local", email: "test@example.com" })!;
    expect(isLegacySingleShopAccountKey(legacy)).toBe(true);
    expect(parseShopIdFromAccountKey(legacy)).toBeNull();
  });

  it("shop-scoped keys append shop id", () => {
    const scoped = `${computeAccountKey({ mode: "supabase", userId: "user-1" })}:550e8400-e29b-41d4-a716-446655440000`;
    expect(parseShopIdFromAccountKey(scoped)).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(isLegacySingleShopAccountKey(scoped)).toBe(false);
  });
});

describe("enterprise foundation — performance budgets", () => {
  it("defines scale targets", () => {
    expect(ENTERPRISE_PERFORMANCE_BUDGETS.maxProductsPerBranch).toBe(100_000);
    expect(ENTERPRISE_PERFORMANCE_BUDGETS.maxDevicesPerOrg).toBe(50);
  });
});
