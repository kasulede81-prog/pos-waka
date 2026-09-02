import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";
import { resetActiveShopForTests, setActiveShopId } from "../offline/shopScope";
import { getOrCreateDeviceId } from "./deviceId";
import {
  canPerformDeviceAuthorizedActionSync,
  clearDeviceAuthorityCache,
  getCachedDeviceAuthoritySync,
  isDeviceAuthorizedForManagement,
  isDeviceAuthorizedForManagementSync,
  seedDeviceAuthorityCacheForTests,
  setShopOwnerDeviceAuthorityBypass,
  type DeviceAuthorityContext,
} from "./deviceAuthority";
import { authorizeStaffAccountMutation } from "./staffAccountAuthorization";
import { authorizeBackupRestore } from "./backupRestoreAuthorization";
import type { SessionActor } from "./sessionActor";

const ACCOUNT_A = "sb:user-a";
const ACCOUNT_B = "sb:user-b";
const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

function approved(partial?: Partial<DeviceAuthorityContext>): DeviceAuthorityContext {
  return {
    shopId: SHOP_A,
    deviceFingerprint: "fp-approved",
    deviceId: "dev-1",
    formFactor: "tablet",
    approvalStatus: "approved",
    isDeviceAuthorized: true,
    isApproved: true,
    isOperational: true,
    status: "active",
    lastSyncAt: null,
    lastLoginAt: null,
    lastSeenAt: null,
    currentStaffClientId: null,
    appVersion: null,
    label: null,
    platform: null,
    pendingUploads: 0,
    pendingDownloads: 0,
    cloudStatus: null,
    recoveryStatus: null,
    ...partial,
  };
}

function installStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  const localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { localStorage, location: { hostname: "localhost" } },
    configurable: true,
  });
  return store;
}

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

describe("SETTINGS-P1 device isolation", () => {
  beforeEach(() => {
    installStorage();
    resetActiveShopForTests();
    setActiveAccountKey(ACCOUNT_A);
    clearDeviceAuthorityCache();
  });

  afterEach(() => {
    clearDeviceAuthorityCache();
    resetActiveShopForTests();
    setActiveAccountKey(null);
  });

  it("T1 — device identity is stable across restarts of getOrCreateDeviceId", () => {
    const first = getOrCreateDeviceId();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(getOrCreateDeviceId()).toBe(first);
    expect(window.localStorage.getItem("waka-pos-device-id")).toBe(first);
  });

  it("T2 / T15 — Account A authority cache does not authorize Account B", () => {
    seedDeviceAuthorityCacheForTests(approved());
    expect(isDeviceAuthorizedForManagementSync()).toBe(true);
    setActiveAccountKey(ACCOUNT_B);
    expect(getCachedDeviceAuthoritySync()).toBeNull();
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
  });

  it("T3 — logout/null account cannot reuse prior device authorization", () => {
    seedDeviceAuthorityCacheForTests(approved());
    expect(isDeviceAuthorizedForManagementSync()).toBe(true);
    setActiveAccountKey(null);
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
  });

  it("T4 — approved device can perform protected management action", () => {
    seedDeviceAuthorityCacheForTests(approved());
    expect(canPerformDeviceAuthorizedActionSync("staff_manage")).toBe(true);
    expect(isDeviceAuthorizedForManagement(approved())).toBe(true);
  });

  it("T5 — unapproved device cannot perform protected management action", () => {
    seedDeviceAuthorityCacheForTests(
      approved({
        approvalStatus: "pending",
        isDeviceAuthorized: false,
        isApproved: false,
        isOperational: false,
        status: "disconnected",
      }),
    );
    expect(canPerformDeviceAuthorizedActionSync("staff_manage")).toBe(false);
  });

  it("T6 — direct backup restore mutation still requires approved device", () => {
    const input = {
      actor: actor("owner"),
      snapshot: { kind: "remote" as const, row: { plan_code: "business", max_devices: 5 } } as never,
      authMode: "supabase" as const,
      purpose: "user_import" as const,
    };
    expect(authorizeBackupRestore(input).ok).toBe(false);
    seedDeviceAuthorityCacheForTests(approved());
    expect(authorizeBackupRestore(input).ok).toBe(true);
  });

  it("T7 / T8 — shop-level cache: Shop A approval does not authorize Shop B", () => {
    setActiveShopId(SHOP_A);
    seedDeviceAuthorityCacheForTests(approved({ shopId: SHOP_A }));
    expect(isDeviceAuthorizedForManagementSync()).toBe(true);
    setActiveShopId(SHOP_B);
    expect(getCachedDeviceAuthoritySync()).toBeNull();
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
    setShopOwnerDeviceAuthorityBypass(SHOP_A);
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
  });

  it("T9 — revoked/disconnected cache is not authorized", () => {
    seedDeviceAuthorityCacheForTests(
      approved({
        approvalStatus: "revoked",
        isDeviceAuthorized: false,
        isApproved: false,
        isOperational: false,
        status: "revoked",
      }),
    );
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
    clearDeviceAuthorityCache();
    expect(isDeviceAuthorizedForManagementSync()).toBe(false);
  });

  it("T10 — unauthorized role cannot manage staff (device-management adjacent mutation)", () => {
    seedDeviceAuthorityCacheForTests(approved());
    expect(authorizeStaffAccountMutation(actor("cashier")).ok).toBe(false);
    const page = readSrc("../pages/DeviceManagementPage.tsx");
    expect(page).toContain("if (!shopId || !isShopOwner) return;");
  });

  it("T11 — owner role is allowed at the staff-management permission boundary", () => {
    seedDeviceAuthorityCacheForTests(approved());
    expect(authorizeStaffAccountMutation(actor("owner")).ok).toBe(true);
  });

  it("T12 — offline cache is used only for the matching account+shop", () => {
    seedDeviceAuthorityCacheForTests(approved({ shopId: SHOP_A }));
    expect(getCachedDeviceAuthoritySync()?.shopId).toBe(SHOP_A);
    setActiveAccountKey(ACCOUNT_B);
    expect(getCachedDeviceAuthoritySync()).toBeNull();
  });

  it("T13 — device identity/authority modules do not persist credentials", () => {
    const idSrc = readSrc("./deviceId.ts");
    const authSrc = readSrc("./deviceAuthority.ts");
    expect(idSrc).not.toMatch(/password|pinHash|refresh_token|access_token/i);
    expect(authSrc).not.toMatch(/password|pinHash|refresh_token|access_token/i);
    expect(idSrc).toContain("waka-pos-device-id");
  });

  it("T14 — DeviceActivationGateOutlet contract is unchanged", () => {
    const gate = readSrc("../components/DeviceActivationGateOutlet.tsx");
    expect(gate).toContain("pathAllowedWhenDeviceBlocked");
    expect(gate).toContain("Checking device access");
    const ctx = readSrc("../context/DeviceActivationContext.tsx");
    expect(ctx).toContain("resolveLoginDeviceActivation");
    expect(ctx).toContain('p === "/settings/devices"');
  });

  it("T1 continued — account switch does not rotate installation device id", () => {
    const id = getOrCreateDeviceId();
    setActiveAccountKey(ACCOUNT_B);
    expect(getOrCreateDeviceId()).toBe(id);
  });
});
