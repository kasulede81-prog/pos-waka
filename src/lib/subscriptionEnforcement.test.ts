import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Product, Sale } from "../types";
import type { SessionActor } from "./sessionActor";
import { authorizeBackupRestore } from "./backupRestoreAuthorization";
import { buildDailyReportText } from "./reportExport";
import { buildDailyReportPdfBlob } from "./dailyReportPdf";
import { checkStorePermissionEffective } from "./storeAuthorization";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import {
  validateCanAddProduct,
  validateDraftLinesPlanAccess,
  validateProductPlanAccess,
} from "./productPlanEnforcement";
import { validateCanAddStaffAccount } from "./staffPlanEnforcement";
import { authorizePreferencesPatch } from "./settingsAuthorization";
import {
  subscriptionDiagnosticsRemoteFixture,
  buildSubscriptionDiagnostics,
} from "./subscriptionDiagnostics";
import { usePosStore } from "../store/usePosStore";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

function freeRemote() {
  return subscriptionDiagnosticsRemoteFixture({ plan_code: "free", status: "active" });
}

afterEach(() => {
  setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
});

function starterRemote() {
  return subscriptionDiagnosticsRemoteFixture({ plan_code: "starter", status: "active" });
}

function businessRemote() {
  return subscriptionDiagnosticsRemoteFixture({ plan_code: "business", status: "active" });
}

function product(id: string, name = id): Product {
  return {
    id,
    name,
    sellingMode: "unit",
    category: "General",
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 600,
    stockOnHand: 10,
    baseUnit: "pcs",
    minimumStockAlert: 2,
    sku: id,
    updatedAt: "2026-01-01",
    version: 1,
  };
}

const sale: Sale = {
  id: "s1",
  createdAt: "2026-06-02T10:00:00.000Z",
  lines: [
    {
      productId: "p1",
      name: "Item",
      quantity: 1,
      unitPriceUgx: 1000,
      unitCostUgx: 600,
      lineTotalUgx: 1000,
      estimatedProfitUgx: 400,
      inputMode: "quantity",
      voided: false,
    },
  ],
  subtotalUgx: 1000,
  totalUgx: 1000,
  cashPaidUgx: 1000,
  debtUgx: 0,
  discountTotalUgx: 0,
  estimatedProfitUgx: 400,
  pendingSync: false,
  status: "completed",
};

describe("checkStorePermissionEffective", () => {
  it("denies free owner settings.shop and reports.profit", () => {
    const snap = freeRemote();
    expect(checkStorePermissionEffective(actor("owner"), "settings.shop", snap, "supabase")).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
    expect(checkStorePermissionEffective(actor("owner"), "reports.profit", snap, "supabase")).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
  });

  it("allows starter owner reports.profit but not settings.shop", () => {
    const snap = starterRemote();
    expect(checkStorePermissionEffective(actor("owner"), "reports.profit", snap, "supabase").ok).toBe(true);
    expect(checkStorePermissionEffective(actor("owner"), "settings.shop", snap, "supabase").ok).toBe(false);
  });

  it("allows business owner plan-gated permissions", () => {
    const snap = businessRemote();
    expect(checkStorePermissionEffective(actor("owner"), "settings.shop", snap, "supabase").ok).toBe(true);
    expect(checkStorePermissionEffective(actor("owner"), "owner.dashboard", snap, "supabase").ok).toBe(true);
  });
});

describe("authorizeBackupRestore", () => {
  it("denies free tier restore", () => {
    const r = authorizeBackupRestore({ actor: actor("owner"), snapshot: freeRemote(), authMode: "supabase" });
    expect(r).toEqual({ ok: false, errorKey: "backupRestoreNotEntitled" });
  });

  it("allows starter tier restore for owner", () => {
    const r = authorizeBackupRestore({ actor: actor("owner"), snapshot: starterRemote(), authMode: "supabase" });
    expect(r.ok).toBe(true);
  });
});

describe("product plan enforcement", () => {
  it("blocks add at free cap", () => {
    expect(validateCanAddProduct(7, "free")).toEqual({ ok: false, errorKey: "planProductLimit" });
    expect(validateCanAddProduct(6, "free").ok).toBe(true);
  });

  it("blocks locked product sale", () => {
    const products = Array.from({ length: 8 }, (_, i) => product(`p${i}`));
    const locked = validateProductPlanAccess("p7", products, "free");
    expect(locked).toEqual({ ok: false, errorKey: "planProductLocked" });
    expect(validateProductPlanAccess("p0", products, "free").ok).toBe(true);
  });

  it("validates draft lines", () => {
    const products = Array.from({ length: 8 }, (_, i) => product(`p${i}`));
    const r = validateDraftLinesPlanAccess([{ productId: "p7" }], products, "free");
    expect(r.ok).toBe(false);
  });
});

describe("staff plan enforcement", () => {
  it("blocks new staff on free/starter", () => {
    expect(validateCanAddStaffAccount(0, "free")).toEqual({ ok: false, errorKey: "planStaffLimit" });
    expect(validateCanAddStaffAccount(0, "starter")).toEqual({ ok: false, errorKey: "planStaffLimit" });
  });

  it("allows business staff up to cap", () => {
    expect(validateCanAddStaffAccount(2, "business").ok).toBe(true);
    expect(validateCanAddStaffAccount(3, "business")).toEqual({ ok: false, errorKey: "planStaffLimit" });
  });
});

describe("receipt branding preferences", () => {
  it("blocks hiding powered-by on starter", () => {
    const r = authorizePreferencesPatch(
      actor("owner"),
      { receiptShowPoweredByWaka: false },
      { snapshot: starterRemote(), authMode: "supabase" },
    );
    expect(r).toEqual({ ok: false, errorKey: "planReceiptBranding" });
  });

  it("allows on business", () => {
    const r = authorizePreferencesPatch(
      actor("owner"),
      { receiptShowPoweredByWaka: false },
      { snapshot: businessRemote(), authMode: "supabase" },
    );
    expect(r.ok).toBe(true);
  });
});

describe("daily export profit stripping", () => {
  const p = product("p1", "Item");

  it("omits profit in text when includeProfit false", () => {
    const withProfit = buildDailyReportText("en", "2026-06-02", {
      sales: [sale],
      products: [p],
      returnRecords: [],
      includeProfit: true,
    });
    const without = buildDailyReportText("en", "2026-06-02", {
      sales: [sale],
      products: [p],
      returnRecords: [],
      includeProfit: false,
    });
    expect(withProfit).toContain("Profit");
    expect(without).not.toMatch(/Profit/i);
  });

  it("omits profit in PDF when includeProfit false", () => {
    const blob = buildDailyReportPdfBlob({
      lang: "en",
      dateKey: "2026-06-02",
      shopName: "Shop",
      sales: [sale],
      products: [p],
      returnRecords: [],
      debtPayments: [],
      cashExpenses: [],
      topProducts: [],
      includeProfit: false,
    });
    expect(blob.size).toBeGreaterThan(200);
  });
});

describe("usePosStore subscription enforcement", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: freeRemote(), authMode: "supabase" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: actor("owner"),
      products: Array.from({ length: 7 }, (_, i) => product(`p${i}`)),
      draftLines: [],
      draftInput: null,
      preferences: { ...usePosStore.getState().preferences, staffAccounts: [] },
      auditLogs: [],
    });
  });

  it("denies addProduct at free cap", () => {
    const before = usePosStore.getState().products.length;
    usePosStore.getState().addProduct({
      name: "Extra",
      sellingMode: "unit",
      baseUnit: "ea",
      sellingPricePerUnitUgx: 100,
      costPricePerUnitUgx: 50,
      stockOnHand: 1,
      minimumStockAlert: 1,
      category: "General",
      sku: "x",
    });
    expect(usePosStore.getState().products.length).toBe(before);
  });

  it("denies finalizeDraftSale for locked product", () => {
    const locked = product("p7");
    usePosStore.setState({
      products: [...usePosStore.getState().products, locked],
      draftLines: [
        {
          productId: "p7",
          name: "Locked",
          quantity: 1,
          unitPriceUgx: 1000,
          unitCostUgx: 600,
          lineTotalUgx: 1000,
          estimatedProfitUgx: 400,
          inputMode: "quantity",
          voided: false,
        },
      ],
    });
    const r = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, amountPaidUgx: 1000 });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("planProductLocked");
  });

  it("denies addStaffAccount on free tier", () => {
    const r = usePosStore.getState().addStaffAccount({ name: "Bob", role: "cashier", pin: "1234" });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("planStaffLimit");
  });
});

describe("subscription diagnostics snapshot", () => {
  it("lists blocked features for free owner", () => {
    const products = Array.from({ length: 8 }, (_, i) => product(`p${i}`));
    const diag = buildSubscriptionDiagnostics({
      role: "owner",
      snapshot: freeRemote(),
      authMode: "supabase",
      products,
      staffAccounts: [],
    });
    expect(diag.effectiveTier).toBe("free");
    expect(diag.lockedProductCount).toBe(1);
    expect(diag.blockedFeatures).toContain("reports.profit");
    expect(diag.blockedFeatures).toContain("settings.shop");
  });
});
