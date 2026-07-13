import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./promiseTimeout", () => ({
  withTimeout: async <T>(promise: Promise<T>, _ms: number, _fallback: T) => promise,
}));

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { resolvePrimaryOrganizationForUser } from "./fetchShopSubscription";
import { supabase } from "./supabase";
import { readCachedShopMemberRole, writeCachedShopMemberRole } from "./shopMemberRoleCache";
import { fetchShopMemberRoleForUser } from "./shopMemberRole";

function installStorage(): void {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
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
    },
    configurable: true,
  });
}

describe("shopMemberRoleCache", () => {
  beforeEach(() => {
    installStorage();
    localStorage.clear();
  });

  it("reads and writes cached roles per user", () => {
    writeCachedShopMemberRole("user-1", "owner");
    expect(readCachedShopMemberRole("user-1")).toBe("owner");
    expect(readCachedShopMemberRole("user-2")).toBeNull();
  });
});

describe("fetchShopMemberRoleForUser", () => {
  beforeEach(() => {
    vi.mocked(resolvePrimaryOrganizationForUser).mockResolvedValue({
      organizationId: "org-1",
      shopId: "shop-1",
    });
  });

  it("returns normalized shop member role", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { role: "owner" }, error: null });
    const eqSecond = vi.fn().mockReturnValue({ maybeSingle });
    const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
    vi.mocked(supabase!.from).mockReturnValue({ select: vi.fn().mockReturnValue({ eq: eqFirst }) } as never);

    await expect(fetchShopMemberRoleForUser("user-1")).resolves.toBe("owner");
  });
});
