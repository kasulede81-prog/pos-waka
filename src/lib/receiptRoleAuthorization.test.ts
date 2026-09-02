import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { defaultHospitalityFloor } from "./hospitality";
import { defaultHospitalityHardwarePrefs, resolveHospitalityHardware } from "./hospitalityHardware";
import { hasPermission } from "./permissions";
import { actorHasPermission } from "./actorAuthorization";
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
import {
  clearSensitiveActionSession,
  grantSensitiveActionSession,
} from "./sensitiveActionAuth";
import type { SessionActor } from "./sessionActor";
import type { Permission, PrinterStationRole, UserRole } from "../types";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: `user-${role}`, role, displayName: role };
}

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

const RECEIPT_PRINTER_INPUT = {
  name: "Front receipt printer",
  connectionType: "usb" as const,
  paperWidth: "80mm" as const,
  stationRoles: ["receipt" as const],
};

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("SETTINGS-P1-RECEIPT-ROLE", () => {
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
        receiptCustomHeaderText: "Original header",
        receiptPaperSize: "58mm",
        hospitalityHardware: defaultHospitalityHardwarePrefs("restaurant"),
        hospitalityFloor: defaultHospitalityFloor(),
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

  describe("T1 — receipt Settings view authorization", () => {
    it("gates /settings/receipt on settings.receipt (not settings.shop)", () => {
      const src = readSrc("../App.tsx");
      const start = src.indexOf('path="settings/receipt"');
      const end = src.indexOf('path="settings/selling"');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const slice = src.slice(start, end);
      expect(slice).toContain('permission="settings.receipt"');
      expect(slice).not.toContain('permission="settings.shop"');
      expect(slice).toContain("SettingsChangeGate");
    });

    it("hub tile and page use settings.receipt; intended roles can open it", () => {
      const hub = readSrc("../pages/SettingsHubPage.tsx");
      expect(hub).toContain('actorHasPermission(actor, "settings.receipt")');
      const page = readSrc("../pages/SettingsReceiptPage.tsx");
      expect(page).toContain('actorHasPermission(actor, "settings.receipt")');
      expect(page).toContain("canEditReceipt");
      const catalog = readSrc("./backOfficeSearchCatalog.ts");
      expect(catalog).toContain('path: "/settings/receipt"');
      expect(catalog).toContain('perm: "settings.receipt"');

      expect(hasPermission("owner", "settings.receipt")).toBe(true);
      expect(hasPermission("manager", "settings.receipt")).toBe(true);
      expect(hasPermission("supervisor", "settings.receipt")).toBe(true);
      expect(hasPermission("cashier", "settings.receipt")).toBe(false);
      expect(hasPermission("waiter", "settings.receipt")).toBe(false);
      expect(hasPermission("stock_keeper", "settings.receipt")).toBe(false);
    });
  });

  describe("T2 / T3 / T4 — receipt branding mutation boundary", () => {
    it("T2 — manager and supervisor can persist receipt branding", () => {
      for (const role of ["manager", "supervisor"] as const) {
        usePosStore.setState({ sessionActor: actor(role), auditLogs: [] });
        const patch = { receiptCustomHeaderText: `${role} header` };
        expect(authorizePreferencesPatch(actor(role), patch).ok).toBe(true);
        usePosStore.getState().setPreferences(patch);
        expect(usePosStore.getState().preferences.receiptCustomHeaderText).toBe(`${role} header`);
      }
    });

    it("T3 — cashier, waiter, and stock_keeper cannot persist receipt branding", () => {
      for (const role of ["cashier", "waiter", "stock_keeper"] as const) {
        usePosStore.setState({ sessionActor: actor(role), auditLogs: [] });
        const before = usePosStore.getState().preferences.receiptCustomHeaderText;
        expect(authorizePreferencesPatch(actor(role), { receiptCustomHeaderText: "Hacked" }).ok).toBe(false);
        usePosStore.getState().setPreferences({ receiptCustomHeaderText: "Hacked" });
        expect(usePosStore.getState().preferences.receiptCustomHeaderText).toBe(before);
        expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
      }
    });

    it("T4 — direct setPreferences cannot bypass authorizePreferencesPatch", () => {
      expect(requiredPermissionsForPreferencesPatch({ receiptCustomHeaderText: "X" })).toEqual([
        "settings.receipt",
      ]);
      expect(requiredPermissionsForPreferencesPatch({ receiptFooterLines: ["Thanks"] })).toEqual([
        "settings.receipt",
      ]);
      expect(requiredPermissionsForPreferencesPatch({ receiptReturnPolicyText: "24h" })).toEqual([
        "settings.receipt",
      ]);
      const storeSrc = readSrc("../store/usePosStore.ts");
      expect(storeSrc).toContain("authorizePreferencesPatch(state.sessionActor, p");
      usePosStore.setState({ sessionActor: actor("cashier"), auditLogs: [] });
      const before = usePosStore.getState().preferences.receiptCustomFooterText;
      usePosStore.getState().setPreferences({ receiptCustomFooterText: "bypass" });
      expect(usePosStore.getState().preferences.receiptCustomFooterText).toBe(before);
    });
  });

  describe("T5 — printer/station assignment uses hardware authorization", () => {
    it("receipt station role on a printer is settings.devices, not settings.receipt", () => {
      expect(requiredPermissionsForPreferencesPatch({ hospitalityHardware: defaultHospitalityHardwarePrefs() })).toEqual(
        ["settings.devices"],
      );
      expect(requiredPermissionsForPreferencesPatch({ receiptPaperSize: "80mm" })).toEqual(["settings.devices"]);

      usePosStore.setState({ sessionActor: actor("manager"), auditLogs: [] });
      const printersBefore = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
      const upsert = usePosStore.getState().upsertPrinter(RECEIPT_PRINTER_INPUT);
      expect(upsert).toEqual({ ok: false, errorKey: "forbidden" });
      expect(resolveHospitalityHardware(usePosStore.getState().preferences).printers).toEqual(printersBefore);

      usePosStore.setState({ sessionActor: actor("owner"), auditLogs: [] });
      const created = usePosStore.getState().upsertPrinter(RECEIPT_PRINTER_INPUT);
      expect(created.ok).toBe(true);
      expect(
        resolveHospitalityHardware(usePosStore.getState().preferences).printers.some((p) =>
          p.stationRoles.includes("receipt"),
        ),
      ).toBe(true);

      const stationId = usePosStore.getState().preferences.hospitalityFloor!.stations[0]!.id;
      usePosStore.setState({ sessionActor: actor("supervisor"), auditLogs: [] });
      expect(usePosStore.getState().assignStationPrinter(stationId, created.printerId!)).toEqual({
        ok: false,
        errorKey: "forbidden",
      });
    });
  });

  describe("T6 — test print stays separate from persistent configuration", () => {
    it("testConfiguredPrinter is ungated and does not mutate printers", async () => {
      const hwSrc = readSrc("../store/hardwarePrintMutations.ts");
      const start = hwSrc.indexOf("testConfiguredPrinter:");
      const end = hwSrc.indexOf("cancelQueuedPrintJob:");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const testFn = hwSrc.slice(start, end);
      expect(testFn).not.toContain("authorizePersistentHardwareConfig");
      expect(testFn).not.toContain("authorizePreferencesPatch");

      usePosStore.setState({ sessionActor: actor("manager"), auditLogs: [] });
      const printersBefore = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
      const missing = await usePosStore.getState().testConfiguredPrinter("missing-printer");
      expect(missing).toEqual({ ok: false, error: "Printer not found." });
      expect(resolveHospitalityHardware(usePosStore.getState().preferences).printers).toEqual(printersBefore);
      expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(false);
    });
  });

  describe("T7 — no false success on denied mutation", () => {
    it("auto-save stays idle and does not claim saved when the patch is denied", () => {
      const src = readSrc("../components/enterprise/usePreferencesAutoSave.ts");
      expect(src).toContain("authorizePreferencesPatch");
      expect(src).toMatch(/if\s*\(!auth\.ok\)\s*\{\s*setStatus\("idle"\);\s*return;/);
      expect(src.indexOf('setStatus("idle")')).toBeLessThan(src.indexOf('setStatus("saved")'));
    });

    it("unauthorized setPreferences does not persist a saved header", () => {
      usePosStore.setState({ sessionActor: actor("cashier"), auditLogs: [] });
      usePosStore.getState().setPreferences({ receiptCustomHeaderText: "Looks saved" });
      expect(usePosStore.getState().preferences.receiptCustomHeaderText).not.toBe("Looks saved");
      expect(usePosStore.getState().preferences.receiptCustomHeaderText).toBe("Original header");
    });
  });

  describe("T8 / T9 — shop and account isolation", () => {
    it("T8 — receipt configuration shares the shop-scoped persistence namespace", () => {
      const nsA = buildPersistenceNamespace("sb:user-1", SHOP_A);
      const nsB = buildPersistenceNamespace("sb:user-1", SHOP_B);
      expect(nsA).toBe(`sb:user-1:${SHOP_A}`);
      expect(nsB).toBe(`sb:user-1:${SHOP_B}`);
      expect(nsA).not.toBe(nsB);
    });

    it("T9 — receipt authorization cannot cross accounts via role reuse", () => {
      const nsA = buildPersistenceNamespace("sb:user-a", SHOP_A);
      const nsB = buildPersistenceNamespace("sb:user-b", SHOP_A);
      expect(nsA).not.toBe(nsB);
      expect(authorizePreferencesPatch(actor("cashier"), { receiptCustomHeaderText: "Account leak" }).ok).toBe(
        false,
      );
      expect(hasPermission("cashier", "settings.receipt")).toBe(false);
    });
  });

  describe("T10 — device isolation (current policy: branding is not device-gated)", () => {
    it("receipt branding does not require device approval; unauthorized device still cannot bypass role", () => {
      const authSrc = readSrc("./settingsAuthorization.ts");
      expect(authSrc).not.toContain("deviceAuthority");
      expect(authSrc).not.toContain("isDeviceAuthorized");
      expect(isDeviceAuthorizedForManagementSync()).toBe(false);
      expect(authorizePreferencesPatch(actor("manager"), { receiptCustomHeaderText: "No device" }).ok).toBe(true);
      expect(authorizePreferencesPatch(actor("cashier"), { receiptCustomHeaderText: "No device" }).ok).toBe(false);
    });
  });

  describe("T11 — Security Gate does not bypass role authorization", () => {
    it("a satisfied change_settings session does not let a cashier persist receipt branding", () => {
      grantSensitiveActionSession();
      expect(authorizePreferencesPatch(actor("cashier"), { receiptCustomHeaderText: "Gate bypass" }).ok).toBe(
        false,
      );
      expect(authorizePreferencesPatch(actor("manager"), { receiptCustomHeaderText: "Gate ok" }).ok).toBe(true);
    });
  });

  describe("T13 — actual sale receipt printing is not a Settings mutation", () => {
    it("printSaleReceipt does not go through settings authorization", () => {
      const docs = readSrc("./receiptDocuments.ts");
      expect(docs).toContain("export async function printSaleReceipt");
      expect(docs).not.toContain("authorizePreferencesPatch");
      expect(docs).not.toContain("settings.receipt");
      expect(docs).not.toContain("settings.devices");
      expect(hasPermission("cashier", "receipts.view")).toBe(true);
      expect(hasPermission("cashier", "settings.receipt")).toBe(false);
    });
  });

  describe("T14 — receipt-role semantics (no new permission invented)", () => {
    it("receipt is a printer station role, not a new user permission", () => {
      const stationRoles: PrinterStationRole[] = [
        "kitchen",
        "bar",
        "coffee",
        "dessert",
        "grill",
        "pizza",
        "fryer",
        "receipt",
        "other",
      ];
      expect(stationRoles).toContain("receipt");

      const panel = readSrc("../components/hardware/PrinterManagementPanel.tsx");
      expect(panel).toContain('"receipt"');

      const registry = readSrc("./printerRegistry.ts");
      expect(registry).toContain('p.stationRoles.includes("receipt")');

      const types = readSrc("../types.ts");
      expect(types).toContain('| "settings.receipt"');
      expect(types).not.toContain("settings.receipts");
      expect(types).not.toContain("receipt.manage");
      expect(types).not.toContain("receipt.role");

      const knownPermissions: Permission[] = ["settings.view", "settings.shop", "settings.receipt", "settings.devices"];
      expect(knownPermissions).toContain("settings.receipt");

      const roles: UserRole[] = ["owner", "manager", "supervisor", "cashier", "waiter", "kitchen", "bar"];
      expect(actorHasPermission(actor("manager"), "settings.receipt")).toBe(true);
      expect(roles.filter((r) => hasPermission(r, "settings.receipt"))).toEqual([
        "owner",
        "manager",
        "supervisor",
      ]);
    });
  });
});
