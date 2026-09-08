import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setActiveAccountKey } from "../offline/accountScope";
import { getActiveShopId, getPersistenceNamespace, resetActiveShopForTests, setActiveShopId } from "../offline/shopScope";
import { usePosStore } from "../store/usePosStore";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";

/** Shop A = oldest membership. Shop B = later membership. IDs are valid shop UUIDs. */
const ids = vi.hoisted(() => ({
  SHOP_A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  SHOP_B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  SHOP_C: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  USER_ID: "11111111-1111-4111-8111-111111111111",
}));
const SHOP_A = ids.SHOP_A;
const SHOP_B = ids.SHOP_B;
const SHOP_C = ids.SHOP_C;
const USER_ID = ids.USER_ID;

type CloudShopRow = {
  id: string;
  organization_id: string;
  name: string | null;
  business_type: string | null;
  phone_e164: string | null;
  address_line: string | null;
  district_id: string | null;
  city: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
};

const shops: Record<string, CloudShopRow> = {
  [SHOP_A]: {
    id: SHOP_A,
    organization_id: "org-1",
    name: "Shop A",
    business_type: "kiosk_duka",
    phone_e164: "+256700000001",
    address_line: "Shop A Street",
    district_id: "district-a",
    city: "Kampala",
    area: "Nakasero",
    latitude: 0.3,
    longitude: 32.5,
  },
  [SHOP_B]: {
    id: SHOP_B,
    organization_id: "org-1",
    name: "Shop B",
    business_type: "kiosk_duka",
    phone_e164: "+256700000002",
    address_line: "Shop B Street",
    district_id: "district-b",
    city: "Entebbe",
    area: "Airport",
    latitude: 0.04,
    longitude: 32.4,
  },
};

const mockState = vi.hoisted(() => ({
  queriedShopIds: [] as string[],
  shopMembersQueried: false,
  memberOrderUsed: false,
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: ids.USER_ID } }, error: null })),
    },
    rpc: vi.fn(async () => ({ data: { complete: true, missing: [] }, error: null })),
    from: (table: string) => {
      if (table === "shop_members") {
        mockState.shopMembersQueried = true;
        return {
          select: () => ({
            eq: () => ({
              order: (_col: string) => {
                mockState.memberOrderUsed = true;
                return {
                  limit: () => ({
                    maybeSingle: async () => ({ data: { shop_id: ids.SHOP_A }, error: null }),
                  }),
                };
              },
            }),
          }),
        };
      }
      if (table !== "shops") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: (_col: string, id: string) => {
            mockState.queriedShopIds.push(id);
            return {
              maybeSingle: async () => {
                const row = shops[id];
                // RLS: only membership shops A and B are visible. Shop C is denied.
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              },
            };
          },
        }),
      };
    },
  },
}));

vi.mock("./ownerOnboarding", () => ({
  fetchOwnerOnboardingStatus: vi.fn(async () => ({ complete: true, missing: [] })),
  writeCachedOwnerOnboardingComplete: vi.fn(),
}));

function seedOwnerStore(overrides?: Partial<ReturnType<typeof createDefaultPreferences>>) {
  setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
  setActiveAccountKey(`sb:${USER_ID}`);
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    preferences: {
      ...createDefaultPreferences(),
      onboardingDone: true,
      ...overrides,
    },
  });
}

describe("BACKOFFICE-03 active-shop profile hydration", () => {
  beforeEach(async () => {
    mockState.queriedShopIds = [];
    mockState.shopMembersQueried = false;
    mockState.memberOrderUsed = false;
    resetActiveShopForTests();
    setActiveAccountKey(`sb:${USER_ID}`);
    seedOwnerStore();
  });

  it("source: hydrate/load bind to getActiveShopId, not oldest membership", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "./businessProfile.ts"), "utf8");
    const helper = src.slice(
      src.indexOf("export async function loadCloudShopProfileForActiveShop"),
      src.indexOf("async function getPrimaryShopForUser"),
    );
    const hydrate = src.slice(
      src.indexOf("export async function hydrateLocalShopProfileFromCloud"),
      src.indexOf("export async function loadPrimaryShopLocationFromCloud"),
    );
    const loadLoc = src.slice(
      src.indexOf("export async function loadPrimaryShopLocationFromCloud"),
      src.indexOf("export async function saveBusinessProfileToCloud"),
    );

    expect(helper).toContain("getActiveShopId");
    expect(helper).not.toContain("shop_members");
    expect(helper).not.toContain("created_at");
    expect(hydrate).toContain("loadCloudShopProfileForActiveShop");
    expect(hydrate).not.toContain("getPrimaryShopForUser");
    expect(hydrate).not.toContain("created_at");
    expect(loadLoc).toContain("loadCloudShopProfileForActiveShop");
    expect(loadLoc).not.toContain("getPrimaryShopForUser");
    expect(loadLoc).not.toContain("created_at");
  });

  it("A — active Shop A hydrates Shop A's profile", async () => {
    setActiveShopId(SHOP_A);
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    const prefs = usePosStore.getState().preferences;
    expect(prefs.shopDisplayName).toBe("Shop A");
    expect(prefs.shopPhoneE164).toBe("+256700000001");
    expect(prefs.shopCurrency).toBe("UGX");
    expect(mockState.queriedShopIds).toEqual([SHOP_A]);
    expect(mockState.shopMembersQueried).toBe(false);
  });

  it("B — member of A+B with active Shop B hydrates Shop B", async () => {
    setActiveShopId(SHOP_B);
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    const prefs = usePosStore.getState().preferences;
    expect(prefs.shopDisplayName).toBe("Shop B");
    expect(prefs.shopPhoneE164).toBe("+256700000002");
    expect(mockState.queriedShopIds).toEqual([SHOP_B]);
    expect(mockState.queriedShopIds).not.toContain(SHOP_A);
  });

  it("C — oldest membership (Shop A) is never the selector when Shop B is active", async () => {
    setActiveShopId(SHOP_B);
    const { hydrateLocalShopProfileFromCloud, loadPrimaryShopLocationFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    const loc = await loadPrimaryShopLocationFromCloud();
    expect(mockState.shopMembersQueried).toBe(false);
    expect(mockState.memberOrderUsed).toBe(false);
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop B");
    expect(loc?.shopId).toBe(SHOP_B);
    expect(loc?.shopName).toBe("Shop B");
  });

  it("D — Shop B local preferences are not overwritten by Shop A's cloud profile", async () => {
    setActiveShopId(SHOP_B);
    seedOwnerStore({
      shopDisplayName: "Shop B",
      shopPhoneE164: "+256700000002",
      shopAddressLine: "Shop B Street",
    });
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    const prefs = usePosStore.getState().preferences;
    expect(prefs.shopDisplayName).toBe("Shop B");
    expect(prefs.shopDisplayName).not.toBe("Shop A");
    expect(prefs.shopPhoneE164).not.toBe("+256700000001");
    expect(prefs.shopAddressLine).toBe("Shop B Street");
  });

  it("E — after switching A → B, hydration loads Shop B", async () => {
    setActiveShopId(SHOP_A);
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop A");

    setActiveShopId(SHOP_B);
    expect(getActiveShopId()).toBe(SHOP_B);
    expect(getPersistenceNamespace()).toBe(`sb:${USER_ID}:${SHOP_B}`);
    seedOwnerStore({ shopDisplayName: "Shop B local partition" });
    mockState.queriedShopIds = [];
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop B");
    expect(mockState.queriedShopIds).toEqual([SHOP_B]);
  });

  it("F — after switching B → A, hydration loads Shop A", async () => {
    setActiveShopId(SHOP_B);
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop B");

    setActiveShopId(SHOP_A);
    expect(getPersistenceNamespace()).toBe(`sb:${USER_ID}:${SHOP_A}`);
    seedOwnerStore({ shopDisplayName: "Shop A local partition" });
    mockState.queriedShopIds = [];
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop A");
    expect(mockState.queriedShopIds).toEqual([SHOP_A]);
  });

  it("G — single-shop owner hydrates normally", async () => {
    setActiveShopId(SHOP_A);
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop A");
    expect(usePosStore.getState().preferences.shopPhoneE164).toBe("+256700000001");
    expect(usePosStore.getState().preferences.shopCurrency).toBe("UGX");
  });

  it("H — no active shop is a no-op and does not fall back to oldest membership", async () => {
    seedOwnerStore({
      shopDisplayName: "Local Only",
      shopPhoneE164: "+256799999999",
    });
    expect(getActiveShopId()).toBeNull();
    const { hydrateLocalShopProfileFromCloud, loadPrimaryShopLocationFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    const loc = await loadPrimaryShopLocationFromCloud();
    expect(loc).toBeNull();
    expect(mockState.queriedShopIds).toEqual([]);
    expect(mockState.shopMembersQueried).toBe(false);
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Local Only");
    expect(usePosStore.getState().preferences.shopPhoneE164).toBe("+256799999999");
  });

  it("I — name/phone/currency hydrate from the active shops row; address stays local (existing hydrate)", async () => {
    setActiveShopId(SHOP_B);
    seedOwnerStore({
      shopDisplayName: "stale",
      shopPhoneE164: null,
      shopAddressLine: "Keep this address",
      shopCurrency: "UGX",
    });
    const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    const prefs = usePosStore.getState().preferences;
    expect(prefs.shopDisplayName).toBe("Shop B");
    expect(prefs.shopPhoneE164).toBe("+256700000002");
    expect(prefs.shopCurrency).toBe("UGX");
    expect(prefs.shopAddressLine).toBe("Keep this address");
  });

  it("does not load an unauthorized Shop C into the active partition", async () => {
    setActiveShopId(SHOP_C);
    seedOwnerStore({ shopDisplayName: "Shop B", shopPhoneE164: "+256700000002" });
    const { hydrateLocalShopProfileFromCloud, loadPrimaryShopLocationFromCloud } = await import("./businessProfile");
    await hydrateLocalShopProfileFromCloud();
    expect(await loadPrimaryShopLocationFromCloud()).toBeNull();
    expect(usePosStore.getState().preferences.shopDisplayName).toBe("Shop B");
    expect(mockState.queriedShopIds).toEqual([SHOP_C, SHOP_C]);
  });

  it("loadPrimaryShopLocationFromCloud returns the active shop, not Shop A", async () => {
    setActiveShopId(SHOP_B);
    const { loadPrimaryShopLocationFromCloud } = await import("./businessProfile");
    const loc = await loadPrimaryShopLocationFromCloud();
    expect(loc).toMatchObject({
      shopId: SHOP_B,
      shopName: "Shop B",
      phoneE164: "+256700000002",
      city: "Entebbe",
      area: "Airport",
    });
    expect(loc?.shopId).not.toBe(SHOP_A);
    expect(mockState.shopMembersQueried).toBe(false);
  });
});
