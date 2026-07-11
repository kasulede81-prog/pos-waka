import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccount } from "../types";
import {
  applyStaffDeltaToCache,
  downloadStaffDelta,
  fetchCloudStaffVersion,
  refreshStaffCacheBackground,
} from "./staffCacheSync";
import { sanitizeStaffForCache, isStaffSuspendedForLogin } from "./offlineStaffCache";

function staff(id: string, extra?: Partial<StaffAccount>): StaffAccount {
  return {
    id,
    name: `Staff ${id}`,
    role: "cashier",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    pinHash: "pbkdf2:test",
    ...extra,
  };
}

vi.mock("./supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: vi.fn(() => true),
}));

vi.mock("../offline/cloudSync", () => ({
  resolveShopCtx: vi.fn(async () => ({ shopId: "shop-1", userId: "user-1" })),
}));

vi.mock("./deviceId", () => ({
  getOrCreateDeviceId: vi.fn(() => "device-fp-1"),
}));

const cacheStore = new Map<string, unknown>();

vi.mock("./offlineStaffCache", async () => {
  const actual = await vi.importActual<typeof import("./offlineStaffCache")>("./offlineStaffCache");
  return {
    ...actual,
    getCachedStaffVersion: vi.fn(async () => cacheStore.get("version") ?? 0),
    readOfflineStaffCache: vi.fn(async () => cacheStore.get("record") ?? null),
    writeOfflineStaffCache: vi.fn(async (record: unknown) => {
      cacheStore.set("record", record);
      cacheStore.set("version", (record as { version: number }).version);
    }),
  };
});

vi.mock("./deviceAuthority", () => ({
  fetchDeviceAuthorityContext: vi.fn(async () => ({
    isDeviceAuthorized: true,
    isApproved: true,
    isOperational: true,
    approvalStatus: "approved",
  })),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: vi.fn(() => ({
      preferences: { shopDisplayName: "Test Shop", staffAccounts: [] },
    })),
    setState: vi.fn(),
  },
}));

describe("applyStaffDeltaToCache", () => {
  it("bootstraps full cache when local version is zero", () => {
    const delta = {
      unchanged: false,
      version: 3,
      changed: [staff("a"), staff("b")],
      removedClientIds: [],
    };
    const next = applyStaffDeltaToCache(null, "shop-1", delta);
    expect(next.version).toBe(3);
    expect(next.staff).toHaveLength(2);
    expect(next.staff.every((s) => s.pin == null && s.password == null)).toBe(true);
  });

  it("applies delta removals and upserts", () => {
    const existing = {
      shopId: "shop-1",
      version: 2,
      downloadedAt: "2026-06-01T00:00:00.000Z",
      staff: [staff("keep"), staff("drop")],
    };
    const delta = {
      unchanged: false,
      version: 3,
      changed: [staff("keep", { name: "Updated Keep" }), staff("new")],
      removedClientIds: ["drop"],
    };
    const next = applyStaffDeltaToCache(existing, "shop-1", delta);
    expect(next.version).toBe(3);
    expect(next.staff.map((s) => s.id).sort()).toEqual(["keep", "new"]);
    expect(next.staff.find((s) => s.id === "keep")?.name).toBe("Updated Keep");
  });

  it("returns unchanged record when delta unchanged", () => {
    const existing = {
      shopId: "shop-1",
      version: 5,
      downloadedAt: "2026-06-01T00:00:00.000Z",
      staff: [staff("a")],
    };
    const next = applyStaffDeltaToCache(existing, "shop-1", {
      unchanged: true,
      version: 5,
      changed: [],
      removedClientIds: [],
    });
    expect(next.version).toBe(5);
    expect(next.staff).toHaveLength(1);
  });
});

describe("sanitizeStaffForCache", () => {
  it("strips plaintext pin and password", () => {
    const rows = sanitizeStaffForCache([
      staff("a", { pin: "1234", password: "secret", pinHash: "hash" }),
    ]);
    expect(rows[0]?.pin).toBeNull();
    expect(rows[0]?.password).toBeNull();
    expect(rows[0]?.pinHash).toBe("hash");
  });
});

describe("isStaffSuspendedForLogin", () => {
  it("blocks inactive staff", () => {
    expect(isStaffSuspendedForLogin(staff("a", { active: false }))).toBe(true);
  });

  it("blocks locked staff", () => {
    const locked = staff("a", { lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(isStaffSuspendedForLogin(locked)).toBe(true);
  });
});

describe("refreshStaffCacheBackground", () => {
  beforeEach(() => {
    cacheStore.clear();
    vi.clearAllMocks();
  });

  it("skips download when cloud version matches local", async () => {
    cacheStore.set("version", 4);
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockImplementation((async (fn: string) => {
      if (fn === "shop_pos_staff_version") return { data: { version: 4 }, error: null };
      return { data: null, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const updated = await refreshStaffCacheBackground();
    expect(updated).toBe(false);
    expect(supabase!.rpc).not.toHaveBeenCalledWith("shop_pos_staff_download", expect.anything());
  });

  it("downloads delta when cloud version is newer", async () => {
    cacheStore.set("version", 1);
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockImplementation((async (fn: string) => {
      if (fn === "shop_pos_staff_version") return { data: { version: 2 }, error: null };
      if (fn === "shop_pos_staff_download") {
        return {
          data: {
            unchanged: false,
            version: 2,
            changed: [{ client_id: "s1", id: "s1", name: "Alice", role: "cashier", is_active: true }],
            removed_client_ids: [],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const updated = await refreshStaffCacheBackground();
    expect(updated).toBe(true);
    expect(cacheStore.get("version")).toBe(2);
  });
});

describe("fetchCloudStaffVersion", () => {
  it("returns version from rpc", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({ data: { version: 7 }, error: null } as any);
    const version = await fetchCloudStaffVersion("shop-1");
    expect(version).toBe(7);
  });
});

describe("downloadStaffDelta", () => {
  it("parses rpc response", async () => {
    const { supabase } = await import("./supabase");
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: {
        unchanged: false,
        version: 2,
        changed: [
          {
            client_id: "s1",
            id: "s1",
            name: "Bob",
            role: "cashier",
            is_active: true,
            pin_hash: "hash",
          },
        ],
        removed_client_ids: ["gone"],
      },
      error: null,
    } as any);
    const delta = await downloadStaffDelta("shop-1", 1);
    expect(delta?.version).toBe(2);
    expect(delta?.changed).toHaveLength(1);
    expect(delta?.removedClientIds).toEqual(["gone"]);
  });
});
