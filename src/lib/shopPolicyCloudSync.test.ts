import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBusinessProfile } from "../config/businessTypes";
import { createDefaultPreferences } from "../data/defaultSeed";
import { resolveNewExpenseApprovalStatus } from "./cashExpenses";
import { resolveDiscountControlMode, validateDraftDiscount } from "./discountGovernance";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { setActiveAccountKey } from "../offline/accountScope";
import * as syncEngine from "../offline/syncEngine";
import { usePosStore } from "../store/usePosStore";
import type { ShopPreferences } from "../types";
import {
  buildShopPolicyPushPayload,
  mergeShopPolicyPreferences,
  parseShopPolicyPullPayload,
  preferencesPatchNeedsShopPolicySync,
  preferencesPatchTouchesShopPolicy,
  shopPolicyRemoteWins,
  stampShopPolicyPreferencePatch,
  type ShopPolicyCloudDocument,
} from "./shopPolicyCloudSync";
import { preferencesPatchTouchesCatalog } from "./catalogCloudSync";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";

function prefs(partial: Partial<ShopPreferences> = {}): ShopPreferences {
  return { ...createDefaultPreferences(), ...partial };
}

describe("shopPolicyCloudSync merge", () => {
  it("E — remote payload changes Device B preferences", () => {
    const local = prefs({
      discountControlMode: "unrestricted",
      kioskQuickSell: true,
      shopPolicyRevisions: { discountControlMode: "2026-09-01T00:00:00.000Z" },
    });
    const remote: ShopPolicyCloudDocument = {
      shopId: SHOP_A,
      discountControlMode: { value: "max_percent", updatedAt: "2026-09-06T12:00:00.000Z" },
    };
    const merged = mergeShopPolicyPreferences(local, remote, SHOP_A);
    expect(merged.discountControlMode).toBe("max_percent");
    expect(merged.shopPolicyRevisions?.discountControlMode).toBe("2026-09-06T12:00:00.000Z");
    expect(merged.kioskQuickSell).toBe(true);
  });

  it("F — remote false/0 overwrite local true/nonzero when timestamps win", () => {
    const local = prefs({
      kioskQuickSell: true,
      staffCanRecordCashExpenses: true,
      requireCashierExpenseApproval: true,
      discountMaxPercentThreshold: 25,
      shopPolicyRevisions: {
        kioskQuickSell: "2026-09-01T00:00:00.000Z",
        staffCanRecordCashExpenses: "2026-09-01T00:00:00.000Z",
        requireCashierExpenseApproval: "2026-09-01T00:00:00.000Z",
        discountMaxPercentThreshold: "2026-09-01T00:00:00.000Z",
      },
    });
    const remote: ShopPolicyCloudDocument = {
      kioskQuickSell: { value: false, updatedAt: "2026-09-06T12:00:00.000Z" },
      staffCanRecordCashExpenses: { value: false, updatedAt: "2026-09-06T12:00:00.000Z" },
      requireCashierExpenseApproval: { value: false, updatedAt: "2026-09-06T12:00:00.000Z" },
      discountMaxPercentThreshold: { value: 0, updatedAt: "2026-09-06T12:00:00.000Z" },
    };
    const merged = mergeShopPolicyPreferences(local, remote, SHOP_A);
    expect(merged.kioskQuickSell).toBe(false);
    expect(merged.staffCanRecordCashExpenses).toBe(false);
    expect(merged.requireCashierExpenseApproval).toBe(false);
    expect(merged.discountMaxPercentThreshold).toBe(0);
  });

  it("G — partial remote payload does not erase unrelated local preferences", () => {
    const local = prefs({
      discountControlMode: "manager_approval",
      discountMaxPercentThreshold: 15,
      kioskQuickSell: false,
      staffCanRecordCashExpenses: true,
      requireCashierExpenseApproval: true,
      saleSoundOn: true,
      receiptPaperSize: "58mm",
      shopDisplayName: "Keep Me",
    });
    const remote: ShopPolicyCloudDocument = {
      discountControlMode: { value: "max_percent", updatedAt: "2026-09-06T12:00:00.000Z" },
    };
    const merged = mergeShopPolicyPreferences(local, remote, SHOP_A);
    expect(merged.discountControlMode).toBe("max_percent");
    expect(merged.discountMaxPercentThreshold).toBe(15);
    expect(merged.kioskQuickSell).toBe(false);
    expect(merged.staffCanRecordCashExpenses).toBe(true);
    expect(merged.requireCashierExpenseApproval).toBe(true);
    expect(merged.saleSoundOn).toBe(true);
    expect(merged.receiptPaperSize).toBe("58mm");
    expect(merged.shopDisplayName).toBe("Keep Me");
  });

  it("H — Shop A policy cannot hydrate Shop B", () => {
    const local = prefs({ discountControlMode: "unrestricted" });
    const remote: ShopPolicyCloudDocument = {
      shopId: SHOP_A,
      discountControlMode: { value: "max_percent", updatedAt: "2026-09-06T12:00:00.000Z" },
    };
    const merged = mergeShopPolicyPreferences(local, remote, SHOP_B);
    expect(merged.discountControlMode).toBe("unrestricted");
  });

  it("J — newer timestamp wins; equal timestamps use deterministic value tie-break", () => {
    expect(
      shopPolicyRemoteWins("2026-09-06T10:00:00.000Z", "2026-09-06T11:00:00.000Z", "unrestricted", "max_percent"),
    ).toBe(true);
    expect(
      shopPolicyRemoteWins("2026-09-06T11:00:00.000Z", "2026-09-06T10:00:00.000Z", "max_percent", "unrestricted"),
    ).toBe(false);

    const at = "2026-09-06T12:00:00.000Z";
    const local = prefs({
      discountControlMode: "max_percent",
      shopPolicyRevisions: { discountControlMode: at },
    });
    const remoteUnrestricted: ShopPolicyCloudDocument = {
      discountControlMode: { value: "unrestricted", updatedAt: at },
    };
    const remoteManager: ShopPolicyCloudDocument = {
      discountControlMode: { value: "manager_approval", updatedAt: at },
    };
    // Equal timestamps: lexicographically greater canonical value wins ("unrestricted" > "max_percent").
    expect(mergeShopPolicyPreferences(local, remoteUnrestricted, SHOP_A).discountControlMode).toBe("unrestricted");
    expect(mergeShopPolicyPreferences(local, remoteManager, SHOP_A).discountControlMode).toBe("max_percent");
  });

  it("legacy empty remote document is a no-op", () => {
    const local = prefs({ discountControlMode: "manager_approval" });
    expect(mergeShopPolicyPreferences(local, { empty: true }, SHOP_A)).toBe(local);
    expect(mergeShopPolicyPreferences(local, null, SHOP_A)).toBe(local);
  });

  it("parseShopPolicyPullPayload keeps false/0 and empty rows", () => {
    expect(parseShopPolicyPullPayload({ ok: true, empty: true })?.empty).toBe(true);
    const parsed = parseShopPolicyPullPayload({
      ok: true,
      shop_id: SHOP_A,
      kiosk_quick_sell: false,
      kiosk_quick_sell_updated_at: "2026-09-06T12:00:00.000Z",
      discount_max_percent_threshold: 0,
      discount_max_percent_threshold_updated_at: "2026-09-06T12:00:00.000Z",
    });
    expect(parsed?.kioskQuickSell).toEqual({ value: false, updatedAt: "2026-09-06T12:00:00.000Z" });
    expect(parsed?.discountMaxPercentThreshold).toEqual({ value: 0, updatedAt: "2026-09-06T12:00:00.000Z" });
  });

  it("K — hydrated discount policy is observed by validateDraftDiscount", () => {
    const local = prefs({ discountControlMode: "unrestricted" });
    const merged = mergeShopPolicyPreferences(local, {
      discountControlMode: { value: "max_percent", updatedAt: "2026-09-06T12:00:00.000Z" },
      discountMaxPercentThreshold: { value: 10, updatedAt: "2026-09-06T12:00:00.000Z" },
    });
    expect(resolveDiscountControlMode(merged)).toBe("max_percent");
    const blocked = validateDraftDiscount({
      prefs: merged,
      role: "cashier",
      discountUgx: 20_000,
      lineSubtotalUgx: 100_000,
    });
    expect(blocked.ok).toBe(false);
  });

  it("L — hydrated expense policy is observed by resolveNewExpenseApprovalStatus", () => {
    const local = prefs({
      staffCanRecordCashExpenses: false,
      requireCashierExpenseApproval: false,
    });
    const merged = mergeShopPolicyPreferences(local, {
      staffCanRecordCashExpenses: { value: true, updatedAt: "2026-09-06T12:00:00.000Z" },
      requireCashierExpenseApproval: { value: true, updatedAt: "2026-09-06T12:00:00.000Z" },
    });
    expect(resolveNewExpenseApprovalStatus("cashier", merged)).toBe("pending");
    const off = mergeShopPolicyPreferences(merged, {
      requireCashierExpenseApproval: { value: false, updatedAt: "2026-09-06T13:00:00.000Z" },
    });
    expect(resolveNewExpenseApprovalStatus("cashier", off)).toBe("approved");
  });
});

describe("shopPolicyCloudSync write classification", () => {
  it("A — discountControlMode touches shop-policy sync, not catalog", () => {
    const patch = { discountControlMode: "max_percent" as const };
    expect(preferencesPatchTouchesShopPolicy(patch)).toBe(true);
    expect(preferencesPatchTouchesCatalog(patch)).toBe(false);
    expect(preferencesPatchNeedsShopPolicySync(prefs(), patch)).toBe(true);
  });

  it("B — expense flags touch shop-policy sync", () => {
    const patch = { staffCanRecordCashExpenses: true, requireCashierExpenseApproval: true };
    expect(preferencesPatchTouchesShopPolicy(patch)).toBe(true);
    expect(preferencesPatchTouchesCatalog(patch)).toBe(false);
  });

  it("C — device-only keys do not touch shop-policy sync", () => {
    expect(preferencesPatchTouchesShopPolicy({ saleSoundOn: false })).toBe(false);
    expect(preferencesPatchTouchesShopPolicy({ receiptPaperSize: "58mm" })).toBe(false);
    expect(preferencesPatchTouchesShopPolicy({ backOfficePin: "1234" })).toBe(false);
    expect(preferencesPatchTouchesShopPolicy({ biometricAuthEnabled: true })).toBe(false);
  });

  it("D — catalog-only keys stay on the catalog path", () => {
    const patch = { posCatalogNodes: [] };
    expect(preferencesPatchTouchesCatalog(patch)).toBe(true);
    expect(preferencesPatchTouchesShopPolicy(patch)).toBe(false);
  });

  it("stamps revisions only when a shop-policy value actually changes", () => {
    const prev = prefs({ discountControlMode: "unrestricted" });
    const stamped = stampShopPolicyPreferencePatch(prev, { discountControlMode: "max_percent" }, "2026-09-06T12:00:00.000Z");
    expect(stamped.shopPolicyRevisions?.discountControlMode).toBe("2026-09-06T12:00:00.000Z");
    const same = stampShopPolicyPreferencePatch(prev, { discountControlMode: "unrestricted" }, "2026-09-06T12:00:00.000Z");
    expect(same.shopPolicyRevisions).toBeUndefined();
    expect(preferencesPatchNeedsShopPolicySync(prev, { discountControlMode: "unrestricted" })).toBe(false);
  });

  it("push payload includes false/0 instead of dropping them", () => {
    const payload = buildShopPolicyPushPayload(
      prefs({
        kioskQuickSell: false,
        staffCanRecordCashExpenses: false,
        requireCashierExpenseApproval: false,
        discountMaxPercentThreshold: 0,
        shopPolicyRevisions: {
          kioskQuickSell: "2026-09-06T12:00:00.000Z",
          discountMaxPercentThreshold: "2026-09-06T12:00:00.000Z",
        },
      }),
    );
    expect(payload.kiosk_quick_sell).toBe(false);
    expect(payload.staff_can_record_cash_expenses).toBe(false);
    expect(payload.require_cashier_expense_approval).toBe(false);
    expect(payload.discount_max_percent_threshold).toBe(0);
  });
});

describe("shopPolicyCloudSync store write path", () => {
  let enqueueSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    setActiveAccountKey("sb:shop-policy-test");
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

  async function queuedKinds(): Promise<string[]> {
    await vi.waitFor(() => expect(enqueueSpy.mock.calls.length).toBeGreaterThan(0));
    return enqueueSpy.mock.calls.map((call) => (call[0] as { kind: string }).kind);
  }

  it("A — setPreferences(discountControlMode) queues pending_shop_policy", async () => {
    usePosStore.getState().setPreferences({ discountControlMode: "max_percent" });
    expect(usePosStore.getState().preferences.discountControlMode).toBe("max_percent");
    const kinds = await queuedKinds();
    expect(kinds).toContain("pending_shop_policy");
    expect(kinds).not.toContain("pending_catalog");
  });

  it("B — setPreferences(expense flags) queues pending_shop_policy", async () => {
    usePosStore.getState().setPreferences({
      staffCanRecordCashExpenses: true,
      requireCashierExpenseApproval: true,
    });
    const kinds = await queuedKinds();
    expect(kinds).toContain("pending_shop_policy");
    expect(kinds).not.toContain("pending_catalog");
  });

  it("C — saleSoundOn / receiptPaperSize do not queue shop-policy", async () => {
    usePosStore.getState().setPreferences({ saleSoundOn: false });
    usePosStore.getState().setPreferences({ receiptPaperSize: "58mm" });
    await Promise.resolve();
    await Promise.resolve();
    const kinds = enqueueSpy.mock.calls.map((call) => (call[0] as { kind: string }).kind);
    expect(kinds).not.toContain("pending_shop_policy");
  });

  it("D — catalog-only preferences still queue pending_catalog only", async () => {
    usePosStore.getState().setPreferences({ catalogHierarchyEnabled: true });
    const kinds = await queuedKinds();
    expect(kinds).toContain("pending_catalog");
    expect(kinds).not.toContain("pending_shop_policy");
  });

  it("I — offline shop-policy mutation still enqueues through the normal engine", async () => {
    usePosStore.getState().setPreferences({ discountControlMode: "manager_approval" });
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pending_shop_policy",
        payload: { type: "shop_policy" },
      }),
    );
    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    expect(store).not.toMatch(/shop_push_shop_policy/);
    expect(store).toContain('queueRemote("pending_shop_policy"');
  });
});

describe("shopPolicyCloudSync wiring", () => {
  it("does not use snapshots or catalog as the shop-policy authority", () => {
    const sync = readFileSync(join(ROOT, "src/lib/shopPolicyCloudSync.ts"), "utf8");
    expect(sync).not.toContain("shop_cloud_snapshots");
    expect(sync).not.toContain("shop_push_catalog");
    expect(sync).not.toContain('queueRemote("pending_catalog"');
    const migration = readFileSync(join(ROOT, "supabase/migrations/177_shop_policy_sync.sql"), "utf8");
    expect(migration).toContain("shop_push_shop_policy");
    expect(migration).toContain("shop_pull_shop_policy");
    expect(migration).toContain("user_can_manage_shop");
    expect(migration).toContain("user_is_cashier_or_above");
    expect(migration.toLowerCase()).toContain("not shop_cloud_snapshots");
    expect(migration).toContain("shop_policy_lww_wins");
  });

  it("enqueues pending_shop_policy and merges on pull separately from catalog", () => {
    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    expect(store).toContain('queueRemote("pending_shop_policy"');
    expect(store).toContain("queueShopPolicyCloudSync()");
    expect(store).toContain("queueCatalogCloudSync()");
    const cloud = readFileSync(join(ROOT, "src/offline/cloudSync.ts"), "utf8");
    expect(cloud).toContain('case "pending_shop_policy"');
    expect(cloud).toContain('case "pending_catalog"');
    expect(cloud).toContain("mergeShopPolicyPreferences");
    expect(cloud).toContain("pullShopPolicyFromRpc");
    expect(cloud).toContain("mergeCatalogPreferences");
  });
});

describe("BACKOFFICE-02 P2 kiosk first-sync LWW", () => {
  const EPOCH = "1970-01-01T00:00:00.000Z";

  it("seeds kiosk_quick_sell default false in migration 177", () => {
    const migration = readFileSync(join(ROOT, "supabase/migrations/177_shop_policy_sync.sql"), "utf8");
    expect(migration).toMatch(/kiosk_quick_sell boolean not null default false/);
    expect(migration).not.toMatch(/kiosk_quick_sell boolean not null default true/);
  });

  it("business-type defaults: pharmacy/wholesale false, kiosk_duka true", () => {
    expect(getBusinessProfile("pharmacy").kioskQuickSellDefault).toBe(false);
    expect(getBusinessProfile("wholesale").kioskQuickSellDefault).toBe(false);
    expect(getBusinessProfile("boutique").kioskQuickSellDefault).toBe(false);
    expect(getBusinessProfile("hardware").kioskQuickSellDefault).toBe(false);
    expect(getBusinessProfile("kiosk_duka").kioskQuickSellDefault).toBe(true);
  });

  it("Scenario A — first unrelated save keeps intended kiosk false", () => {
    const local = prefs({
      businessType: "pharmacy",
      kioskQuickSell: false,
      discountControlMode: "unrestricted",
      discountMaxPercentThreshold: 10,
      staffCanRecordCashExpenses: false,
      requireCashierExpenseApproval: false,
    });
    const stamped = stampShopPolicyPreferencePatch(local, { discountControlMode: "max_percent" }, "2026-09-06T12:00:00.000Z");
    const payload = buildShopPolicyPushPayload({ ...local, ...stamped, discountControlMode: "max_percent" });
    expect(payload.kiosk_quick_sell).toBe(false);
    expect(payload.kiosk_quick_sell_updated_at).toBe(EPOCH);
    expect(payload.discount_control_mode).toBe("max_percent");

    const merged = mergeShopPolicyPreferences(
      { ...local, discountControlMode: "max_percent" },
      {
        shopId: SHOP_A,
        kioskQuickSell: { value: false, updatedAt: EPOCH },
        discountControlMode: { value: "max_percent", updatedAt: "2026-09-06T12:00:00.000Z" },
        staffCanRecordCashExpenses: { value: false, updatedAt: EPOCH },
        requireCashierExpenseApproval: { value: false, updatedAt: EPOCH },
        discountMaxPercentThreshold: { value: 10, updatedAt: EPOCH },
      },
      SHOP_A,
    );
    expect(merged.kioskQuickSell).toBe(false);
    expect(merged.discountControlMode).toBe("max_percent");
    expect(merged.staffCanRecordCashExpenses).toBe(false);
    expect(merged.requireCashierExpenseApproval).toBe(false);
    expect(merged.discountMaxPercentThreshold).toBe(10);
  });

  it("Scenario B — explicit true persists and Device B converges", () => {
    const deviceA = prefs({ kioskQuickSell: false });
    const stamped = stampShopPolicyPreferencePatch(deviceA, { kioskQuickSell: true }, "2026-09-06T10:00:00.000Z");
    expect(stamped.shopPolicyRevisions?.kioskQuickSell).toBe("2026-09-06T10:00:00.000Z");
    expect(buildShopPolicyPushPayload({ ...deviceA, ...stamped, kioskQuickSell: true }).kiosk_quick_sell).toBe(true);

    const deviceB = mergeShopPolicyPreferences(
      prefs({ kioskQuickSell: false }),
      { shopId: SHOP_A, kioskQuickSell: { value: true, updatedAt: "2026-09-06T10:00:00.000Z" } },
      SHOP_A,
    );
    expect(deviceB.kioskQuickSell).toBe(true);
  });

  it("Scenario C — newer explicit false overwrites true", () => {
    const merged = mergeShopPolicyPreferences(
      prefs({
        kioskQuickSell: true,
        shopPolicyRevisions: { kioskQuickSell: "2026-09-06T10:00:00.000Z" },
      }),
      { shopId: SHOP_A, kioskQuickSell: { value: false, updatedAt: "2026-09-06T11:00:00.000Z" } },
      SHOP_A,
    );
    expect(merged.kioskQuickSell).toBe(false);
  });

  it("Scenario D — unstamped Device B false does not become true from a false@epoch cloud row", () => {
    const deviceB = mergeShopPolicyPreferences(
      prefs({ businessType: "pharmacy", kioskQuickSell: false }),
      {
        shopId: SHOP_A,
        kioskQuickSell: { value: false, updatedAt: EPOCH },
        discountControlMode: { value: "max_percent", updatedAt: "2026-09-06T12:00:00.000Z" },
      },
      SHOP_A,
    );
    expect(deviceB.kioskQuickSell).toBe(false);
    expect(deviceB.discountControlMode).toBe("max_percent");
  });

  it("Scenario E — existing LWW: newer timestamp still wins either direction", () => {
    expect(shopPolicyRemoteWins("2026-09-06T10:00:00.000Z", "2026-09-06T11:00:00.000Z", true, false)).toBe(true);
    expect(shopPolicyRemoteWins("2026-09-06T11:00:00.000Z", "2026-09-06T10:00:00.000Z", false, true)).toBe(false);
  });

  it("unstamped local default cannot overwrite an explicit cloud true", () => {
    const merged = mergeShopPolicyPreferences(
      prefs({ kioskQuickSell: false }),
      { shopId: SHOP_A, kioskQuickSell: { value: true, updatedAt: "2026-09-06T10:00:00.000Z" } },
      SHOP_A,
    );
    expect(merged.kioskQuickSell).toBe(true);

    expect(shopPolicyRemoteWins(EPOCH, "2026-09-06T10:00:00.000Z", false, true)).toBe(true);
    expect(shopPolicyRemoteWins("2026-09-06T10:00:00.000Z", EPOCH, true, false)).toBe(false);
  });

  it("kiosk_duka unstamped true still beats the false SQL seed on equal epoch", () => {
    expect(getBusinessProfile("kiosk_duka").kioskQuickSellDefault).toBe(true);
    expect(shopPolicyRemoteWins(EPOCH, EPOCH, false, true)).toBe(true);
    expect(buildShopPolicyPushPayload(prefs({ kioskQuickSell: true })).kiosk_quick_sell).toBe(true);
    expect(buildShopPolicyPushPayload(prefs({ kioskQuickSell: true })).kiosk_quick_sell_updated_at).toBe(EPOCH);
  });

  it("Shop B does not receive Shop A kiosk policy", () => {
    const merged = mergeShopPolicyPreferences(
      prefs({ kioskQuickSell: false }),
      { shopId: SHOP_A, kioskQuickSell: { value: true, updatedAt: "2026-09-06T10:00:00.000Z" } },
      SHOP_B,
    );
    expect(merged.kioskQuickSell).toBe(false);
  });
});
