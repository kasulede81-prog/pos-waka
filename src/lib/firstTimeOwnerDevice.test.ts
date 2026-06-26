import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyOwnerDeviceLocally,
  clearFirstTimeOwnerMarker,
  evaluateRecoveryApplicability,
  markFirstTimeOwnerOnDevice,
  resolvePostAuthDestination,
  shouldRunCloudRecoveryForAccount,
} from "./firstTimeOwnerDevice";

const mockIsLocalShopDataEmpty = vi.fn();
const mockReadSyncCheckpoints = vi.fn();
const mockShouldRequireRecoveryLock = vi.fn();
const mockIsRecoveryOfflineBypassActive = vi.fn();
const mockReadLastCloudRecoveryDiagnostics = vi.fn();
const mockResetCloudRecoverySessionForRetry = vi.fn();
const mockIsCloudRecoveryLockActive = vi.fn();
const mockGetActiveAccountKey = vi.fn();

const storeState = {
  preferences: {
    onboardingWizardDone: false,
    onboardingDone: false,
    schemaVersion: 1 as const,
    businessType: "kiosk_duka" as const,
    shopDisplayName: "My Shop",
    shopCurrency: "UGX",
    shifts: [] as unknown[],
  },
  products: [] as unknown[],
  sales: [] as unknown[],
  customers: [] as unknown[],
  suppliers: [] as unknown[],
  purchases: [] as unknown[],
  dayCloses: [] as unknown[],
};

vi.mock("./cloudSnapshotSync", () => ({
  isLocalShopDataEmpty: () => mockIsLocalShopDataEmpty(),
}));

vi.mock("./syncCheckpoints", () => ({
  readSyncCheckpoints: () => mockReadSyncCheckpoints(),
}));

vi.mock("./postAuthCloudHydrate", () => ({
  shouldRequireRecoveryLock: () => mockShouldRequireRecoveryLock(),
}));

vi.mock("./startupDiagnostics", () => ({
  isRecoveryOfflineBypassActive: () => mockIsRecoveryOfflineBypassActive(),
  logStartupPhase: vi.fn(),
}));

vi.mock("./cloudRecoverySession", () => ({
  readLastCloudRecoveryDiagnostics: () => mockReadLastCloudRecoveryDiagnostics(),
  isCloudRecoveryLockActive: () => mockIsCloudRecoveryLockActive(),
  resetCloudRecoverySessionForRetry: () => mockResetCloudRecoverySessionForRetry(),
}));

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => mockGetActiveAccountKey(),
}));

vi.mock("./promiseTimeout", () => ({
  withTimeout: <T>(promise: Promise<T>, _ms: number, fallback: T) =>
    promise.catch(() => fallback),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => storeState,
  },
}));

const USER_ID = "11111111-1111-1111-1111-111111111111";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
}));

vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("window", globalThis);

function setupFreshDevice(): void {
  mockIsLocalShopDataEmpty.mockReturnValue(true);
  mockReadSyncCheckpoints.mockReturnValue({ bootstrapComplete: false });
  mockReadLastCloudRecoveryDiagnostics.mockReturnValue(null);
  mockIsRecoveryOfflineBypassActive.mockReturnValue(false);
  mockGetActiveAccountKey.mockReturnValue(`sb:${USER_ID}`);
  mockIsCloudRecoveryLockActive.mockReturnValue(false);
  storeState.preferences.onboardingWizardDone = false;
  storeState.preferences.onboardingDone = false;
  storeState.preferences.schemaVersion = 1;
  storeState.products = [];
}

describe("firstTimeOwnerDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupFreshDevice();
  });

  describe("classifyOwnerDeviceLocally", () => {
    it("marks empty device with no bootstrap as first-time on device", () => {
      const c = classifyOwnerDeviceLocally(USER_ID);
      expect(c.isFirstTimeOnDevice).toBe(true);
      expect(c.localShopDataEmpty).toBe(true);
      expect(c.bootstrapSyncComplete).toBe(false);
      expect(c.onboardingWizardComplete).toBe(false);
    });

    it("is not first-time when local operational data exists", () => {
      mockIsLocalShopDataEmpty.mockReturnValue(false);
      storeState.products = [{ id: "p1" }];
      const c = classifyOwnerDeviceLocally(USER_ID);
      expect(c.isFirstTimeOnDevice).toBe(false);
    });
  });

  describe("evaluateRecoveryApplicability", () => {
    it("skips recovery for brand-new owner marker after email verification", async () => {
      markFirstTimeOwnerOnDevice(USER_ID);
      mockShouldRequireRecoveryLock.mockResolvedValue(true);

      const result = await evaluateRecoveryApplicability(USER_ID);

      expect(result.skipRecovery).toBe(true);
      expect(result.reason).toBe("first_time_owner_marker");
      expect(mockShouldRequireRecoveryLock).not.toHaveBeenCalled();
    });

    it("runs recovery for existing shop on a second device with cloud data", async () => {
      mockShouldRequireRecoveryLock.mockResolvedValue(true);

      const result = await evaluateRecoveryApplicability(USER_ID);

      expect(result.skipRecovery).toBe(false);
      expect(result.recoveryApplicable).toBe(true);
      expect(result.reason).toBe("existing_shop_second_device");
    });

    it("skips recovery for empty device when cloud has no business data", async () => {
      mockShouldRequireRecoveryLock.mockResolvedValue(false);

      const result = await evaluateRecoveryApplicability(USER_ID);

      expect(result.skipRecovery).toBe(true);
      expect(result.reason).toBe("no_cloud_business_data");
    });

    it("does not skip recovery when local bootstrap was already completed on device", async () => {
      mockReadSyncCheckpoints.mockReturnValue({ bootstrapComplete: true });
      mockShouldRequireRecoveryLock.mockResolvedValue(true);

      const result = await evaluateRecoveryApplicability(USER_ID);

      expect(result.skipRecovery).toBe(false);
      expect(result.reason).toBe("prior_local_device_evidence");
    });
  });

  describe("shouldRunCloudRecoveryForAccount", () => {
    it("skips recovery for first-time marker even when cloud lock would be required", async () => {
      markFirstTimeOwnerOnDevice(USER_ID);
      mockShouldRequireRecoveryLock.mockResolvedValue(true);

      const run = await shouldRunCloudRecoveryForAccount(USER_ID);

      expect(run).toBe(false);
      expect(mockShouldRequireRecoveryLock).not.toHaveBeenCalled();
    });

    it("clears stale recovery lock for first-time owner", async () => {
      markFirstTimeOwnerOnDevice(USER_ID);
      mockIsCloudRecoveryLockActive.mockReturnValue(true);

      const run = await shouldRunCloudRecoveryForAccount(USER_ID);

      expect(run).toBe(false);
      expect(mockResetCloudRecoverySessionForRetry).toHaveBeenCalled();
    });
  });

  describe("resolvePostAuthDestination", () => {
    it("always sends brand-new owner to onboarding", () => {
      markFirstTimeOwnerOnDevice(USER_ID);
      expect(resolvePostAuthDestination(USER_ID)).toBe("/onboarding");
    });

    it("sends owner with incomplete wizard to onboarding even without marker", () => {
      expect(resolvePostAuthDestination(USER_ID)).toBe("/onboarding");
    });

    it("sends owner with completed wizard to dashboard", () => {
      storeState.preferences.onboardingWizardDone = true;
      storeState.preferences.onboardingDone = true;
      clearFirstTimeOwnerMarker(USER_ID);
      expect(resolvePostAuthDestination(USER_ID)).toBe("/");
    });
  });
});
