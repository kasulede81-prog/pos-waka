import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";

function mockLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  });
}

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: vi.fn(),
}));

vi.mock("./workspaceBootstrapCache", () => ({
  isWorkspaceBootstrapped: vi.fn(() => true),
  unmarkWorkspaceBootstrapped: vi.fn(),
}));

vi.mock("../offline/localDb", () => ({
  hasIndexedDbDataForAccount: vi.fn(async () => true),
}));

describe("organizationDeletionState", () => {
  const accountKey = "sb:deleted-user";
  const userId = "deleted-user";

  beforeEach(() => {
    mockLocalStorage();
    localStorage.clear();
    setActiveAccountKey(accountKey);
    vi.clearAllMocks();
  });

  it("marks deleted when cloud org is absent for bootstrapped user", async () => {
    const { resolvePrimaryOrganizationForUser } = await import("./fetchShopSubscription");
    vi.mocked(resolvePrimaryOrganizationForUser).mockResolvedValue(null);

    const { refreshOrganizationDeletionState, isDeletedOrganization } = await import("./organizationDeletionState");
    const deleted = await refreshOrganizationDeletionState(userId, accountKey);
    expect(deleted).toBe(true);
    expect(isDeletedOrganization(accountKey)).toBe(true);
  });

  it("clears marker when cloud org exists", async () => {
    const { resolvePrimaryOrganizationForUser } = await import("./fetchShopSubscription");
    vi.mocked(resolvePrimaryOrganizationForUser).mockResolvedValue({
      organizationId: "org-1",
      shopId: "shop-1",
    });

    const {
      markOrganizationDeleted,
      refreshOrganizationDeletionState,
      isDeletedOrganization,
    } = await import("./organizationDeletionState");
    markOrganizationDeleted({ accountKey, userId });
    await refreshOrganizationDeletionState(userId, accountKey);
    expect(isDeletedOrganization(accountKey)).toBe(false);
  });

  it("does not block account switch on deletion marker alone (cloud refresh reconciles)", async () => {
    const { markOrganizationDeleted, assertAccountSwitchAllowed } = await import("./organizationDeletionState");
    markOrganizationDeleted({ accountKey, userId });
    expect(() => assertAccountSwitchAllowed(accountKey)).not.toThrow();
  });

  it("blocks account switch into wiped namespace", async () => {
    const { writeWipeMarker, assertAccountSwitchAllowed, OrganizationDeletedError } = await import(
      "./organizationDeletionState"
    );
    writeWipeMarker(accountKey);
    expect(() => assertAccountSwitchAllowed(accountKey)).toThrow(OrganizationDeletedError);
  });

  it("detects pending deletion", async () => {
    const { markDeletionPending, isDeletionPending } = await import("./organizationDeletionState");
    markDeletionPending({ accountKey, userId });
    expect(isDeletionPending(accountKey)).toBe(true);
  });

  it("expires a stale pending marker without marking deleted", async () => {
    const { markDeletionPending, expireStalePendingDeletion, isDeletionPending, isDeletedOrganization, PENDING_DELETION_TTL_MS } =
      await import("./organizationDeletionState");
    markDeletionPending({ accountKey, userId });
    const key = `waka.org.deletion.marker.v1::${accountKey}`;
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as { markedAt?: string };
    raw.markedAt = new Date(Date.now() - PENDING_DELETION_TTL_MS - 1_000).toISOString();
    localStorage.setItem(key, JSON.stringify(raw));

    expect(expireStalePendingDeletion(accountKey)).toBe(true);
    expect(isDeletionPending(accountKey)).toBe(false);
    expect(isDeletedOrganization(accountKey)).toBe(false);
  });
});
