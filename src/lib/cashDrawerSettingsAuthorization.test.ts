import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { hasPermission } from "./permissions";
import { authorizePreferencesPatch, requiredPermissionsForPreferencesPatch } from "./settingsAuthorization";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { buildPersistenceNamespace } from "../offline/shopScope";
import { setActiveAccountKey } from "../offline/accountScope";
import { resetActiveShopForTests } from "../offline/shopScope";
import {
  clearDeviceAuthorityCache,
  isDeviceAuthorizedForManagementSync,
  setShopOwnerDeviceAuthorityBypass,
} from "./deviceAuthority";
import { clearSensitiveActionSession, grantSensitiveActionSession } from "./sensitiveActionAuth";
import { computeExpectedDrawerCashV2 } from "./cashDrawerLedger";
import { resolveCashDrawerFormulaVersion } from "./dayDrawerOpen";
import type { SessionActor } from "./sessionActor";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: `user-${role}`, role, displayName: role };
}

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("SETTINGS-P1-CASH-DRAWER-FORMULA", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    resetActiveShopForTests();
    setActiveAccountKey("sb:user-a");
    clearSensitiveActionSession();
    clearDeviceAuthorityCache();
    setShopOwnerDeviceAuthorityBypass(null);
    usePosStore.setState({
      _hydrated: true,
      sessionActor: actor("owner"),
      auditLogs: [],
      preferences: {
        ...usePosStore.getState().preferences,
        cashVarianceThresholdPct: 5,
        cashVarianceThresholdUgxFixed: 10_000,
        cashDrawerFormulaVersion: "v2",
        ownerDayOpenCorrectionAfterSales: false,
      },
    });
  });

  afterEach(() => {
    clearSensitiveActionSession();
    clearDeviceAuthorityCache();
    setShopOwnerDeviceAuthorityBypass(null);
    resetActiveShopForTests();
    setActiveAccountKey(null);
  });

  describe("T1 — Settings route/view authorization", () => {
    it("gates /settings/cash-drawer on day.open_drawer and keeps SettingsChangeGate", () => {
      const src = readSrc("../App.tsx");
      const start = src.indexOf('path="settings/cash-drawer"');
      const end = src.indexOf('path="settings/shop"');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const slice = src.slice(start, end);
      expect(slice).toContain('permission="day.open_drawer"');
      expect(slice).not.toContain('permission="settings.shop"');
      expect(slice).not.toContain('permission="settings.devices"');
      expect(slice).toContain("SettingsChangeGate");
      expect(slice).toContain("SettingsCashDrawerPage");
    });

    it("hub, page, and search catalog use day.open_drawer", () => {
      const hub = readSrc("../pages/SettingsHubPage.tsx");
      expect(hub).toContain('actorHasEffectivePermission(actor, "day.open_drawer"');
      expect(hub).toContain('to="/settings/cash-drawer"');
      const page = readSrc("../pages/SettingsCashDrawerPage.tsx");
      expect(page).toContain('actorHasPermission(actor, "day.open_drawer")');
      const catalog = readSrc("./backOfficeSearchCatalog.ts");
      expect(catalog).toContain('path: "/settings/cash-drawer"');
      expect(catalog).toContain('perm: "day.open_drawer"');

      expect(hasPermission("owner", "day.open_drawer")).toBe(true);
      expect(hasPermission("manager", "day.open_drawer")).toBe(true);
      expect(hasPermission("supervisor", "day.open_drawer")).toBe(true);
      expect(hasPermission("cashier", "day.open_drawer")).toBe(false);
      expect(hasPermission("waiter", "day.open_drawer")).toBe(false);
    });
  });

  describe("T2 / T3 / T4 — configuration mutation boundary", () => {
    it("T2 — owner, manager, and supervisor can persist variance and formula version", () => {
      for (const role of ["owner", "manager", "supervisor"] as const) {
        usePosStore.setState({ sessionActor: actor(role), auditLogs: [] });
        const patch = { cashVarianceThresholdPct: 7, cashDrawerFormulaVersion: "v1" as const };
        expect(authorizePreferencesPatch(actor(role), patch).ok).toBe(true);
        usePosStore.getState().setPreferences(patch);
        expect(usePosStore.getState().preferences.cashVarianceThresholdPct).toBe(7);
        expect(usePosStore.getState().preferences.cashDrawerFormulaVersion).toBe("v1");
      }
    });

    it("T2 — only the owner can persist ownerDayOpenCorrectionAfterSales", () => {
      expect(authorizePreferencesPatch(actor("owner"), { ownerDayOpenCorrectionAfterSales: true }).ok).toBe(true);
      expect(authorizePreferencesPatch(actor("manager"), { ownerDayOpenCorrectionAfterSales: true }).ok).toBe(false);
      expect(authorizePreferencesPatch(actor("supervisor"), { ownerDayOpenCorrectionAfterSales: true }).ok).toBe(
        false,
      );
    });

    it("T3 — cashier and waiter cannot persist cash-drawer configuration", () => {
      for (const role of ["cashier", "waiter"] as const) {
        usePosStore.setState({ sessionActor: actor(role), auditLogs: [] });
        const before = usePosStore.getState().preferences.cashDrawerFormulaVersion;
        expect(authorizePreferencesPatch(actor(role), { cashDrawerFormulaVersion: "v1" }).ok).toBe(false);
        usePosStore.getState().setPreferences({ cashDrawerFormulaVersion: "v1" });
        expect(usePosStore.getState().preferences.cashDrawerFormulaVersion).toBe(before);
        expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
      }
    });

    it("T4 — direct setPreferences cannot bypass authorizePreferencesPatch", () => {
      expect(requiredPermissionsForPreferencesPatch({ cashDrawerFormulaVersion: "v1" })).toEqual([
        "day.open_drawer",
      ]);
      expect(requiredPermissionsForPreferencesPatch({ cashVarianceThresholdUgxFixed: 20_000 })).toEqual([
        "day.open_drawer",
      ]);
      const storeSrc = readSrc("../store/usePosStore.ts");
      expect(storeSrc).toContain("authorizePreferencesPatch(state.sessionActor, p");
      usePosStore.setState({ sessionActor: actor("cashier"), auditLogs: [] });
      const pctBefore = usePosStore.getState().preferences.cashVarianceThresholdPct;
      usePosStore.getState().setPreferences({ cashVarianceThresholdPct: 99 });
      expect(usePosStore.getState().preferences.cashVarianceThresholdPct).toBe(pctBefore);
    });
  });

  describe("T5 — no false success", () => {
    it("Settings page does not mark saved when authorizePreferencesPatch denies", () => {
      const src = readSrc("../pages/SettingsCashDrawerPage.tsx");
      expect(src).toContain("authorizePreferencesPatch");
      expect(src).toMatch(/if\s*\(!auth\.ok\)\s*\{[\s\S]*setSaved\(false\);[\s\S]*return;/);
      expect(src.indexOf("setSaved(false)")).toBeLessThan(src.indexOf("setSaved(true)"));
    });
  });

  describe("T6 / T7 / T18 — shop and account isolation", () => {
    it("T6 / T18 — cash-drawer configuration shares the shop-scoped persistence namespace", () => {
      const nsA = buildPersistenceNamespace("sb:user-1", SHOP_A);
      const nsB = buildPersistenceNamespace("sb:user-1", SHOP_B);
      expect(nsA).toBe(`sb:user-1:${SHOP_A}`);
      expect(nsB).toBe(`sb:user-1:${SHOP_B}`);
      expect(nsA).not.toBe(nsB);
    });

    it("T7 — account namespaces remain distinct; cashier still cannot persist", () => {
      const nsA = buildPersistenceNamespace("sb:user-a", SHOP_A);
      const nsB = buildPersistenceNamespace("sb:user-b", SHOP_A);
      expect(nsA).not.toBe(nsB);
      expect(authorizePreferencesPatch(actor("cashier"), { cashDrawerFormulaVersion: "v1" }).ok).toBe(false);
    });
  });

  describe("T8 — Security Gate does not bypass role authorization", () => {
    it("a satisfied change_settings session does not let a cashier persist drawer settings", () => {
      grantSensitiveActionSession();
      expect(authorizePreferencesPatch(actor("cashier"), { cashVarianceThresholdPct: 1 }).ok).toBe(false);
      expect(authorizePreferencesPatch(actor("manager"), { cashVarianceThresholdPct: 1 }).ok).toBe(true);
    });
  });

  describe("T9 — device authorization is not required for drawer Settings prefs", () => {
    it("unauthorized device cannot bypass role; branding-style device gate was not added", () => {
      const authSrc = readSrc("./settingsAuthorization.ts");
      expect(authSrc).not.toContain("deviceAuthority");
      expect(isDeviceAuthorizedForManagementSync()).toBe(false);
      expect(authorizePreferencesPatch(actor("manager"), { cashDrawerFormulaVersion: "v2" }).ok).toBe(true);
      expect(authorizePreferencesPatch(actor("cashier"), { cashDrawerFormulaVersion: "v2" }).ok).toBe(false);
    });
  });

  describe("T10 / T17 — canonical formula unchanged; Settings is not a second calculator", () => {
    it("T10 — computeExpectedDrawerCashV2 still matches the frozen 280,000 acceptance case", () => {
      expect(
        computeExpectedDrawerCashV2({
          openingFloatUgx: 50_000,
          cashSalesUgx: 500_000,
          cashDebtCollectionsUgx: 50_000,
          adjustmentInflowsUgx: 100_000,
          adjustmentOutflowsUgx: 300_000,
          cashExpensesUgx: 20_000,
          cashSupplierPaymentsUgx: 80_000,
          cashRefundsUgx: 20_000,
        }),
      ).toBe(280_000);
    });

    it("T17 — Settings page configures preferences and does not compute expected cash", () => {
      const page = readSrc("../pages/SettingsCashDrawerPage.tsx");
      expect(page).toContain("cashDrawerFormulaVersion");
      expect(page).toContain("cashVarianceThresholdPct");
      expect(page).toContain("authorizePreferencesPatch");
      expect(page).not.toContain("computeExpectedDrawerCashV2");
      expect(page).not.toContain("getDrawerCashForDay");
      expect(page).not.toContain("shiftExpectedCash");
      expect(page).not.toContain("expectedDrawerCashUgx");
      expect(page).toContain("cashSettingsFormulaHint");
      expect(resolveCashDrawerFormulaVersion({})).toBe("v2");
    });
  });
});
