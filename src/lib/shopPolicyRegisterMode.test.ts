/**
 * BACKOFFICE-04 — registerMode + primaryDeviceFingerprint shop-policy sync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setActiveAccountKey } from "../offline/accountScope";
import * as syncEngine from "../offline/syncEngine";
import { mergePreferencesFromPartial, usePosStore } from "../store/usePosStore";
import type { ShopPreferences } from "../types";
import * as deviceId from "./deviceId";
import { assertCanFinalizeStockSale, resolveRegisterMode } from "./primaryRegisterMode";
import {
  buildShopPolicyPushPayload,
  mergeShopPolicyPreferences,
  parseShopPolicyPullPayload,
  preferencesPatchNeedsShopPolicySync,
  preferencesPatchTouchesShopPolicy,
  shopPolicyRemoteWins,
  type ShopPolicyCloudDocument,
} from "./shopPolicyCloudSync";
import { preferencesPatchTouchesCatalog } from "./catalogCloudSync";
import { authorizePreferencesPatch, requiredPermissionsForPreferencesPatch } from "./settingsAuthorization";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const DEVICE_A = "device-A-fingerprint";
const DEVICE_B = "device-B-fingerprint";
const AT_NEW = "2026-09-07T12:00:00.000Z";
const AT_OLD = "2026-09-01T00:00:00.000Z";

function prefs(partial: Partial<ShopPreferences> = {}): ShopPreferences {
  return { ...createDefaultPreferences(), ...partial };
}

function actor(role: "owner" | "manager" | "cashier") {
  return { userId: "user-1", role, displayName: "Test" };
}

describe("BACKOFFICE-04 register mode shop-policy", () => {
  it("Test 1 classification — register fields touch shop-policy, not catalog", () => {
    const patch = { registerMode: "single" as const, primaryDeviceFingerprint: DEVICE_A };
    expect(preferencesPatchTouchesShopPolicy(patch)).toBe(true);
    expect(preferencesPatchTouchesCatalog(patch)).toBe(false);
    expect(preferencesPatchNeedsShopPolicySync(prefs(), patch)).toBe(true);
    expect(preferencesPatchTouchesShopPolicy({ saleSoundOn: false })).toBe(false);
  });

  it("Test 2 — pushed payload contains both register fields", () => {
    const payload = buildShopPolicyPushPayload(
      prefs({
        registerMode: "single",
        primaryDeviceFingerprint: DEVICE_A,
        shopPolicyRevisions: {
          registerMode: AT_NEW,
          primaryDeviceFingerprint: AT_NEW,
        },
      }),
    );
    expect(payload.register_mode).toBe("single");
    expect(payload.register_mode_updated_at).toBe(AT_NEW);
    expect(payload.primary_device_fingerprint).toBe(DEVICE_A);
    expect(payload.primary_device_fingerprint_updated_at).toBe(AT_NEW);
    expect(payload.discount_control_mode).toBe("unrestricted");
  });

  it("Test 3 — Device B pull receives single + Device A fingerprint", () => {
    const local = prefs({
      registerMode: "multi",
      saleSoundOn: true,
      discountControlMode: "unrestricted",
      kioskQuickSell: true,
    });
    const remote: ShopPolicyCloudDocument = {
      shopId: SHOP_A,
      registerMode: { value: "single", updatedAt: AT_NEW },
      primaryDeviceFingerprint: { value: DEVICE_A, updatedAt: AT_NEW },
    };
    const merged = mergeShopPolicyPreferences(local, remote, SHOP_A);
    expect(merged.registerMode).toBe("single");
    expect(merged.primaryDeviceFingerprint).toBe(DEVICE_A);
    expect(resolveRegisterMode(merged)).toBe("single");
  });

  it("Test 4 — existing sale gate allows primary Device A and blocks offline Device B", () => {
    const merged = mergeShopPolicyPreferences(
      prefs(),
      {
        shopId: SHOP_A,
        registerMode: { value: "single", updatedAt: AT_NEW },
        primaryDeviceFingerprint: { value: DEVICE_A, updatedAt: AT_NEW },
      },
      SHOP_A,
    );
    const fp = vi.spyOn(deviceId, "getOrCreateDeviceId");
    fp.mockReturnValue(DEVICE_A);
    expect(
      assertCanFinalizeStockSale({ preferences: merged, isOnline: false, stockFresh: false }),
    ).toEqual({ ok: true });
    fp.mockReturnValue(DEVICE_B);
    expect(
      assertCanFinalizeStockSale({ preferences: merged, isOnline: false, stockFresh: false }),
    ).toEqual({ ok: false, errorKey: "primaryRegisterSyncRequired" });
    fp.mockRestore();
  });

  it("Test 5 — mergePreferencesFromPartial preserves both register fields", () => {
    const restored = mergePreferencesFromPartial({
      preferences: prefs({
        registerMode: "single",
        primaryDeviceFingerprint: DEVICE_A,
        saleSoundOn: false,
      }),
    });
    expect(restored.registerMode).toBe("single");
    expect(restored.primaryDeviceFingerprint).toBe(DEVICE_A);
    expect(restored.saleSoundOn).toBe(false);
  });

  it("Test 6 — register merge does not remove device-local or BACKOFFICE-02 keys", () => {
    const local = prefs({
      registerMode: "multi",
      saleSoundOn: true,
      receiptPaperSize: "58mm",
      discountControlMode: "manager_approval",
      discountMaxPercentThreshold: 15,
      kioskQuickSell: false,
      staffCanRecordCashExpenses: true,
      requireCashierExpenseApproval: true,
      shopDisplayName: "Keep Me",
    });
    const merged = mergeShopPolicyPreferences(
      local,
      {
        shopId: SHOP_A,
        registerMode: { value: "single", updatedAt: AT_NEW },
        primaryDeviceFingerprint: { value: DEVICE_A, updatedAt: AT_NEW },
      },
      SHOP_A,
    );
    expect(merged.registerMode).toBe("single");
    expect(merged.saleSoundOn).toBe(true);
    expect(merged.receiptPaperSize).toBe("58mm");
    expect(merged.discountControlMode).toBe("manager_approval");
    expect(merged.discountMaxPercentThreshold).toBe(15);
    expect(merged.kioskQuickSell).toBe(false);
    expect(merged.staffCanRecordCashExpenses).toBe(true);
    expect(merged.requireCashierExpenseApproval).toBe(true);
    expect(merged.shopDisplayName).toBe("Keep Me");
  });

  it("Test 7 — Shop A register policy cannot hydrate Shop B", () => {
    const local = prefs({ registerMode: "multi", primaryDeviceFingerprint: DEVICE_B });
    const merged = mergeShopPolicyPreferences(
      local,
      {
        shopId: SHOP_A,
        registerMode: { value: "single", updatedAt: AT_NEW },
        primaryDeviceFingerprint: { value: DEVICE_A, updatedAt: AT_NEW },
      },
      SHOP_B,
    );
    expect(merged.registerMode).toBe("multi");
    expect(merged.primaryDeviceFingerprint).toBe(DEVICE_B);
  });

  it("Test 8 — stale register timestamps cannot resurrect an old primary", () => {
    expect(shopPolicyRemoteWins(AT_NEW, AT_OLD, DEVICE_A, DEVICE_B)).toBe(false);
    const local = prefs({
      registerMode: "single",
      primaryDeviceFingerprint: DEVICE_A,
      shopPolicyRevisions: {
        registerMode: AT_NEW,
        primaryDeviceFingerprint: AT_NEW,
      },
    });
    const merged = mergeShopPolicyPreferences(
      local,
      {
        shopId: SHOP_A,
        registerMode: { value: "multi", updatedAt: AT_OLD },
        primaryDeviceFingerprint: { value: DEVICE_B, updatedAt: AT_OLD },
      },
      SHOP_A,
    );
    expect(merged.registerMode).toBe("single");
    expect(merged.primaryDeviceFingerprint).toBe(DEVICE_A);
  });

  it("Test 9 — settings.shop remains required for register fields", () => {
    expect(requiredPermissionsForPreferencesPatch({ registerMode: "single" })).toEqual(["settings.shop"]);
    expect(requiredPermissionsForPreferencesPatch({ primaryDeviceFingerprint: DEVICE_A })).toEqual([
      "settings.shop",
    ]);
    expect(authorizePreferencesPatch(actor("owner"), { registerMode: "single" }).ok).toBe(true);
    expect(authorizePreferencesPatch(actor("cashier"), { registerMode: "single" }).ok).toBe(false);
    expect(authorizePreferencesPatch(actor("cashier"), { primaryDeviceFingerprint: DEVICE_A }).ok).toBe(false);
  });

  it("Test 10 — after pull, offline secondary device is still blocked by the existing gate", () => {
    const deviceBLocal = prefs({ registerMode: "multi" });
    const pulled = mergeShopPolicyPreferences(
      deviceBLocal,
      {
        shopId: SHOP_A,
        registerMode: { value: "single", updatedAt: AT_NEW },
        primaryDeviceFingerprint: { value: DEVICE_A, updatedAt: AT_NEW },
      },
      SHOP_A,
    );
    const fp = vi.spyOn(deviceId, "getOrCreateDeviceId").mockReturnValue(DEVICE_B);
    expect(
      assertCanFinalizeStockSale({
        preferences: pulled,
        isOnline: false,
        stockFresh: true,
      }),
    ).toEqual({ ok: false, errorKey: "primaryRegisterSyncRequired" });
    expect(
      assertCanFinalizeStockSale({
        preferences: pulled,
        isOnline: true,
        stockFresh: true,
      }).ok,
    ).toBe(true);
    fp.mockRestore();
  });

  it("multi mode keeps the existing always-allow contract", () => {
    const fp = vi.spyOn(deviceId, "getOrCreateDeviceId").mockReturnValue(DEVICE_B);
    expect(
      assertCanFinalizeStockSale({
        preferences: prefs({ registerMode: "multi", primaryDeviceFingerprint: DEVICE_A }),
        isOnline: false,
        stockFresh: false,
      }),
    ).toEqual({ ok: true });
    fp.mockRestore();
  });

  it("parse pull payload keeps a null fingerprint (no designated primary)", () => {
    const parsed = parseShopPolicyPullPayload({
      ok: true,
      shop_id: SHOP_A,
      register_mode: "single",
      register_mode_updated_at: AT_NEW,
      primary_device_fingerprint: null,
      primary_device_fingerprint_updated_at: AT_NEW,
    });
    expect(parsed?.registerMode).toEqual({ value: "single", updatedAt: AT_NEW });
    expect(parsed?.primaryDeviceFingerprint).toEqual({ value: null, updatedAt: AT_NEW });
  });
});

describe("BACKOFFICE-04 setPreferences queue", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    setActiveAccountKey("sb:register-mode-test");
    enqueueSpy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined) as unknown as typeof enqueueSpy;
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "owner-1", role: "owner", displayName: "Owner" },
      preferences: createDefaultPreferences(),
    });
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    setActiveAccountKey(null);
  });

  it("Test 1 — setPreferences(registerMode + fingerprint) queues pending_shop_policy once-kind", async () => {
    usePosStore.getState().setPreferences({
      registerMode: "single",
      primaryDeviceFingerprint: DEVICE_A,
    });
    expect(usePosStore.getState().preferences.registerMode).toBe("single");
    expect(usePosStore.getState().preferences.primaryDeviceFingerprint).toBe(DEVICE_A);
    await vi.waitFor(() => expect(enqueueSpy.mock.calls.length).toBeGreaterThan(0));
    const kinds = enqueueSpy.mock.calls.map((call) => (call[0] as { kind: string }).kind);
    expect(kinds).toContain("pending_shop_policy");
    expect(kinds.filter((k) => k === "pending_shop_policy")).toHaveLength(1);
    expect(kinds).not.toContain("pending_catalog");
  });

  it("Test 9 store — cashier cannot change register mode", () => {
    usePosStore.setState({
      sessionActor: { userId: "c1", role: "cashier", displayName: "Cashier" },
    });
    usePosStore.getState().setPreferences({ registerMode: "single", primaryDeviceFingerprint: DEVICE_A });
    expect(usePosStore.getState().preferences.registerMode).not.toBe("single");
    expect(usePosStore.getState().preferences.primaryDeviceFingerprint).not.toBe(DEVICE_A);
  });
});
