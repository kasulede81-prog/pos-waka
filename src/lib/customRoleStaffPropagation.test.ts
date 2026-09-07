/**
 * BACKOFFICE-01 — custom-role permission changes must queue existing staff snapshots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomStaffRole, Permission, StaffAccount } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setActiveAccountKey } from "../offline/accountScope";
import { setActiveShopId } from "../offline/shopScope";
import { usePosStore } from "../store/usePosStore";
import { permissionsForRole } from "./permissions";
import { pickNewerStaffAccount } from "./staffRecovery";
import { resolveStaffPermissions } from "./enterpriseRoles/resolvePermissions";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import * as shopStaffCloud from "./shopStaffCloud";
import * as staffSyncQueue from "./staffSyncQueue";

const ACCOUNT_A = "sb:backoffice-01-a";
const ACCOUNT_B = "sb:backoffice-01-b";
const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE_R = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF_S1 = "11111111-1111-4111-8111-111111111111";
const STAFF_S2 = "22222222-2222-4222-8222-222222222222";
const STAFF_S3 = "33333333-3333-4333-8333-333333333333";

const CASHIER_PERMS = permissionsForRole("cashier");
const ROLE_WITH_SHOP: Permission[] = [...CASHIER_PERMS, "settings.shop"];
const ROLE_WITHOUT_SHOP: Permission[] = [...CASHIER_PERMS];

function actor(role: "owner" | "cashier") {
  return { userId: "owner:1", role, displayName: "Owner" };
}

function customRole(permissions: Permission[], id = ROLE_R): CustomStaffRole {
  return {
    id,
    name: "Supervisor",
    inheritsFrom: "cashier",
    permissions,
    status: "active",
    sourceTemplateId: null,
    clonedFromRoleId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function staff(id: string, opts?: { customRoleId?: string | null; permissions?: Permission[]; updatedAt?: string }): StaffAccount {
  const customRoleId = opts?.customRoleId === undefined ? ROLE_R : opts.customRoleId;
  const permissions = opts?.permissions ?? ROLE_WITH_SHOP;
  return {
    id,
    name: id === STAFF_S1 ? "Sam" : id === STAFF_S2 ? "Pat" : "Lee",
    username: id.slice(0, 8),
    role: "cashier",
    customRoleId,
    permissions,
    pin: null,
    password: null,
    pinHash: null,
    passwordHash: null,
    phone: null,
    active: true,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: opts?.updatedAt ?? "2026-05-01T00:00:00.000Z",
  };
}

function seed(opts?: {
  actorRole?: "owner" | "cashier";
  roles?: CustomStaffRole[];
  staffAccounts?: StaffAccount[];
}) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: actor(opts?.actorRole ?? "owner"),
    preferences: {
      ...createDefaultPreferences(),
      customStaffRoles: opts?.roles ?? [customRole(ROLE_WITH_SHOP)],
      staffAccounts: opts?.staffAccounts ?? [staff(STAFF_S1)],
    },
    auditLogs: [],
  });
}

function queuedStaffUpdates(enqueueSpy: { mock: { calls: unknown[][] } }) {
  return enqueueSpy.mock.calls
    .map((call) => call[0] as { action?: string; staff?: StaffAccount })
    .filter((payload) => payload.action === "update" && payload.staff);
}

describe("BACKOFFICE-01 custom role staff permission propagation", () => {
  let pushSpy: { mockRestore: () => void; mockResolvedValue: (v: boolean) => unknown; mock: { calls: unknown[][] } };
  let enqueueSpy: { mockRestore: () => void; mockClear: () => void; mock: { calls: unknown[][] } };

  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    setActiveAccountKey(ACCOUNT_A);
    setActiveShopId(SHOP_A);
    pushSpy = vi.spyOn(shopStaffCloud, "pushStaffToCloud").mockResolvedValue(false);
    enqueueSpy = vi.spyOn(staffSyncQueue, "enqueuePendingStaffSync").mockResolvedValue(undefined);
    seed();
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
    pushSpy.mockRestore();
    setActiveShopId(null);
    setActiveAccountKey(null);
    vi.restoreAllMocks();
  });

  it("A — role update revokes settings.shop and queues one staff snapshot", async () => {
    const beforeId = usePosStore.getState().preferences.staffAccounts![0]!.id;
    const r = usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });
    expect(r.ok).toBe(true);

    const s = usePosStore.getState().preferences.staffAccounts![0]!;
    expect(s.id).toBe(beforeId);
    expect(s.permissions).not.toContain("settings.shop");
    expect(s.permissions).toEqual(ROLE_WITHOUT_SHOP);

    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    const queued = queuedStaffUpdates(enqueueSpy)[0]!.staff!;
    expect(queued.id).toBe(STAFF_S1);
    expect(queued.permissions).toEqual(ROLE_WITHOUT_SHOP);
    expect(queued.permissions).not.toContain("settings.shop");
    expect("customRoleId" in (queued as object) || queued.customRoleId === ROLE_R).toBe(true);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it("B — delete role applies existing resolver fallback and queues the snapshot", async () => {
    const before = usePosStore.getState().preferences.staffAccounts![0]!;
    const r = usePosStore.getState().removeCustomStaffRole(ROLE_R);
    expect(r.ok).toBe(true);

    const after = usePosStore.getState().preferences.staffAccounts![0]!;
    expect(after.id).toBe(STAFF_S1);
    expect(after.customRoleId).toBeNull();
    const expected = resolveStaffPermissions(
      { role: after.role, permissions: before.permissions, customRoleId: null },
      [],
    );
    expect(after.permissions).toEqual(expected);

    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    expect(queuedStaffUpdates(enqueueSpy)[0]!.staff!.id).toBe(STAFF_S1);
    expect(queuedStaffUpdates(enqueueSpy)[0]!.staff!.permissions).toEqual(expected);
  });

  it("C — role grant adds the permission to the queued snapshot", async () => {
    seed({
      roles: [customRole(ROLE_WITHOUT_SHOP)],
      staffAccounts: [staff(STAFF_S1, { permissions: ROLE_WITHOUT_SHOP })],
    });
    const r = usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITH_SHOP });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.staffAccounts![0]!.permissions).toContain("settings.shop");

    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    expect(queuedStaffUpdates(enqueueSpy)[0]!.staff!.permissions).toContain("settings.shop");
  });

  it("D — unrelated staff are not queued", async () => {
    const unrelatedUpdatedAt = "2026-05-01T00:00:00.000Z";
    seed({
      staffAccounts: [
        staff(STAFF_S1),
        staff(STAFF_S2, { customRoleId: null, permissions: CASHIER_PERMS, updatedAt: unrelatedUpdatedAt }),
      ],
    });
    usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });

    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    expect(queuedStaffUpdates(enqueueSpy)[0]!.staff!.id).toBe(STAFF_S1);

    const s2 = usePosStore.getState().preferences.staffAccounts!.find((s) => s.id === STAFF_S2)!;
    expect(s2.updatedAt).toBe(unrelatedUpdatedAt);
    expect(s2.permissions).toEqual(CASHIER_PERMS);
  });

  it("E — every assigned staff member is updated exactly once", async () => {
    seed({
      staffAccounts: [staff(STAFF_S1), staff(STAFF_S2), staff(STAFF_S3)],
    });
    usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });

    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(3));
    const ids = queuedStaffUpdates(enqueueSpy).map((p) => p.staff!.id).sort();
    expect(ids).toEqual([STAFF_S1, STAFF_S2, STAFF_S3].sort());
    expect(new Set(ids).size).toBe(3);
    for (const row of usePosStore.getState().preferences.staffAccounts ?? []) {
      expect(row.permissions).not.toContain("settings.shop");
    }
  });

  it("F — offline/failed push still updates locally and queues pending_staff", async () => {
    pushSpy.mockResolvedValue(false);
    const r = usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().preferences.staffAccounts![0]!.permissions).not.toContain("settings.shop");

    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalledTimes(1));
    const payload = enqueueSpy.mock.calls[0]![0] as { action: string; staff: StaffAccount };
    expect(payload.action).toBe("update");
    expect(payload.staff.id).toBe(STAFF_S1);
    expect(payload.staff.permissions).not.toContain("settings.shop");
  });

  it("G — role mutation never mints a new staff ID", async () => {
    usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });
    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    expect(usePosStore.getState().preferences.staffAccounts).toHaveLength(1);
    expect(usePosStore.getState().preferences.staffAccounts![0]!.id).toBe(STAFF_S1);
    expect(queuedStaffUpdates(enqueueSpy)[0]!.staff!.id).toBe(STAFF_S1);
  });

  it("H — Shop A role change does not touch Shop B staff or queue", async () => {
    usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });
    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    expect(queuedStaffUpdates(enqueueSpy)[0]!.staff!.id).toBe(STAFF_S1);

    enqueueSpy.mockClear();
    setActiveAccountKey(ACCOUNT_B);
    setActiveShopId(SHOP_B);
    seed({
      staffAccounts: [staff(STAFF_S2, { permissions: ROLE_WITH_SHOP })],
    });
    expect(usePosStore.getState().preferences.staffAccounts![0]!.id).toBe(STAFF_S2);
    expect(usePosStore.getState().preferences.staffAccounts![0]!.permissions).toContain("settings.shop");
    expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(0);
  });

  it("I — role-change updatedAt is newer and loses to a later staff edit", async () => {
    const before = usePosStore.getState().preferences.staffAccounts![0]!.updatedAt;
    usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });
    const roleChanged = usePosStore.getState().preferences.staffAccounts![0]!;
    expect(Date.parse(roleChanged.updatedAt)).toBeGreaterThan(Date.parse(before));

    await vi.waitFor(() => expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(1));
    const queued = queuedStaffUpdates(enqueueSpy)[0]!.staff!;

    usePosStore.getState().updateStaffAccount(STAFF_S1, { name: "Sam Later" });
    const later = usePosStore.getState().preferences.staffAccounts![0]!;
    expect(later.name).toBe("Sam Later");
    expect(Date.parse(later.updatedAt)).toBeGreaterThanOrEqual(Date.parse(roleChanged.updatedAt));
    expect(pickNewerStaffAccount(queued, later).id).toBe(STAFF_S1);
    expect(pickNewerStaffAccount(queued, later).name).toBe("Sam Later");
    expect(pickNewerStaffAccount(queued, later).updatedAt).toBe(later.updatedAt);
  });

  it("J — unauthorized custom-role mutation is rejected and queues nothing", async () => {
    seed({ actorRole: "cashier" });
    const update = usePosStore.getState().updateCustomStaffRole(ROLE_R, { permissions: ROLE_WITHOUT_SHOP });
    expect(update.ok).toBe(false);
    expect(update.errorKey).toBe("forbidden");
    expect(usePosStore.getState().preferences.staffAccounts![0]!.permissions).toContain("settings.shop");

    const remove = usePosStore.getState().removeCustomStaffRole(ROLE_R);
    expect(remove.ok).toBe(false);
    expect(remove.errorKey).toBe("forbidden");

    await Promise.resolve();
    await Promise.resolve();
    expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(0);
    expect(usePosStore.getState().preferences.customStaffRoles).toHaveLength(1);
  });

  it("create with no assigned staff does not queue staff updates", async () => {
    seed({ roles: [], staffAccounts: [staff(STAFF_S1, { customRoleId: null, permissions: CASHIER_PERMS })] });
    const created = usePosStore.getState().addCustomStaffRole({
      name: "Floor lead",
      inheritsFrom: "cashier",
      permissions: ROLE_WITH_SHOP,
    });
    expect(created.ok).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(queuedStaffUpdates(enqueueSpy)).toHaveLength(0);
    expect(usePosStore.getState().preferences.staffAccounts![0]!.id).toBe(STAFF_S1);
    expect(usePosStore.getState().preferences.staffAccounts![0]!.permissions).toEqual(CASHIER_PERMS);
  });
});
