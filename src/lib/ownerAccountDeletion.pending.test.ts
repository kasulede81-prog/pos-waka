import { beforeEach, describe, expect, it, vi } from "vitest";

const accountKey = "sb:owner-39-1";

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

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => accountKey,
}));

describe("ownerAccountDeletion pending marker (Phase 39.1)", () => {
  beforeEach(() => {
    mockLocalStorage();
    localStorage.clear();
  });

  it("clears pending marker after failed deletion", async () => {
    const { markOwnerDeletionInProgress, clearOwnerDeletionPendingOnFailure } = await import(
      "./ownerAccountDeletion"
    );
    const { isDeletionPending, isOrganizationBlocked } = await import("./organizationDeletionState");

    markOwnerDeletionInProgress("owner-39-1");
    expect(isDeletionPending(accountKey)).toBe(true);
    expect(isOrganizationBlocked(accountKey)).toBe(true);

    clearOwnerDeletionPendingOnFailure();
    expect(isDeletionPending(accountKey)).toBe(false);
    expect(isOrganizationBlocked(accountKey)).toBe(false);
  });

  it("escalates pending to deleted after partial cloud success", async () => {
    const {
      markOwnerDeletionInProgress,
      escalateOwnerDeletionPendingAfterPartialCloudSuccess,
    } = await import("./ownerAccountDeletion");
    const { isDeletionPending, isDeletedOrganization } = await import("./organizationDeletionState");

    markOwnerDeletionInProgress("owner-39-1");
    escalateOwnerDeletionPendingAfterPartialCloudSuccess("owner-39-1");

    expect(isDeletionPending(accountKey)).toBe(false);
    expect(isDeletedOrganization(accountKey)).toBe(true);
  });

  it("does not treat a normal failure as deleted", async () => {
    const { markOwnerDeletionInProgress, clearOwnerDeletionPendingOnFailure } = await import(
      "./ownerAccountDeletion"
    );
    const { isDeletedOrganization, isDeletionPending } = await import("./organizationDeletionState");
    markOwnerDeletionInProgress("owner-39-1");
    clearOwnerDeletionPendingOnFailure();
    expect(isDeletionPending(accountKey)).toBe(false);
    expect(isDeletedOrganization(accountKey)).toBe(false);
  });
});
