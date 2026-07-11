import { describe, expect, it, beforeEach, vi } from "vitest";
import { usePosStore } from "../store/usePosStore";
import type { SessionActor } from "./sessionActor";
import {
  authorizeStaffAccountMutation,
  assertStaffAccountMutationAllowed,
  StaffAccountAuthorizationError,
} from "./staffAccountAuthorization";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { clearDeviceAuthorityCache, seedDeviceAuthorityCacheForTests } from "./deviceAuthority";
import { approvedDeviceAuthorityFixture } from "./deviceAuthorityTestFixtures";

vi.mock("./staffSyncQueue", () => ({
  createStaffInCloudFirst: vi.fn(async (row: { id: string }) => ({ ok: true as const, id: row.id })),
}));

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: "user-1", role, displayName: "Test" };
}

describe("staffAccountAuthorization", () => {
  it("allows owner (role check; plan cap is separate)", () => {
    expect(authorizeStaffAccountMutation(actor("owner"))).toEqual({ ok: true });
    expect(() => assertStaffAccountMutationAllowed(actor("owner"))).not.toThrow();
  });

  it("denies cashier and manager", () => {
    expect(authorizeStaffAccountMutation(actor("cashier"))).toEqual({ ok: false, errorKey: "forbidden" });
    expect(authorizeStaffAccountMutation(actor("manager"))).toEqual({ ok: false, errorKey: "forbidden" });
    expect(() => assertStaffAccountMutationAllowed(actor("cashier"))).toThrow(StaffAccountAuthorizationError);
  });

  it("denies when actor is null", () => {
    expect(authorizeStaffAccountMutation(null)).toEqual({ ok: false, errorKey: "noSelection" });
  });
});

describe("usePosStore — staff account CRUD authorization", () => {
  const existingStaff = {
    id: "staff-existing",
    name: "Jane",
    username: "jane",
    role: "cashier" as const,
    permissions: [],
    pin: null,
    password: null,
    pinHash: null,
    passwordHash: null,
    phone: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    clearDeviceAuthorityCache();
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: actor("cashier"),
      preferences: {
        ...usePosStore.getState().preferences,
        staffAccounts: [existingStaff],
      },
      auditLogs: [],
    });
  });

  it("cashier addStaffAccount is denied", async () => {
    const r = await usePosStore.getState().addStaffAccount({
      name: "Bob",
      role: "cashier",
      pin: "1234",
    });
    expect(r.ok).toBe(false);
    expect(usePosStore.getState().preferences.staffAccounts).toHaveLength(1);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("cashier updateStaffAccount is denied", () => {
    usePosStore.getState().updateStaffAccount("staff-existing", { name: "Hacked" });
    expect(usePosStore.getState().preferences.staffAccounts?.[0]?.name).toBe("Jane");
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("cashier removeStaffAccount is denied", () => {
    usePosStore.getState().removeStaffAccount("staff-existing");
    expect(usePosStore.getState().preferences.staffAccounts).toHaveLength(1);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("owner addStaffAccount succeeds on business plan", async () => {
    usePosStore.setState({ sessionActor: actor("owner") });
    const r = await usePosStore.getState().addStaffAccount({
      name: "Bob",
      role: "cashier",
      pin: "5678",
    });
    expect(r.ok).toBe(true);
    expect((usePosStore.getState().preferences.staffAccounts ?? []).length).toBeGreaterThan(1);
  });

  it("owner addStaffAccount persists locally after cloud-first create", async () => {
    seedDeviceAuthorityCacheForTests(approvedDeviceAuthorityFixture());
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "supabase" });
    usePosStore.setState({ sessionActor: actor("owner"), preferences: { ...usePosStore.getState().preferences, staffAccounts: [] } });
    const r = await usePosStore.getState().addStaffAccount({
      name: "Cloud Bob",
      role: "cashier",
      pin: "1234",
    });
    expect(r.ok).toBe(true);
    const saved = usePosStore.getState().preferences.staffAccounts ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("Cloud Bob");
    expect(saved[0]?.pendingCloudSync).toBe(false);
  });
});
