import { describe, expect, it } from "vitest";
import type { Permission, ShopPreferences, UserRole } from "../types";
import { resolveSessionActor } from "../lib/sessionActor";
import {
  FAIL_CLOSED_ROLE,
  hasActorPermission,
  hasPermission,
  normalizeUserRole,
  permissionsForRole,
  resolveAuthRole,
} from "../lib/permissions";

/**
 * Phase 7 — Auth staff permissions and role consistency.
 *
 * The security property under test: a staff member's effective permissions must
 * not depend on HOW they authenticated. A configuration the owner restricted must
 * stay restricted when the person signs in with Google rather than the terminal
 * PIN, and a custom configuration must never lift them above their membership
 * role — which remains what RLS enforces server-side.
 *
 * Client permissions are UI gating; the server is the boundary. These tests still
 * matter because a UI that offers what the server will deny is both a misleading
 * product and a missing layer of defence.
 */

const USER = "11111111-1111-4111-8111-111111111111";

function prefs(overrides: Partial<ShopPreferences> = {}): ShopPreferences {
  return {
    staffAccounts: [],
    customStaffRoles: [],
    activeStaffId: null,
    devRoleOverride: null,
    ...overrides,
  } as unknown as ShopPreferences;
}

function authActor(
  membershipRole: UserRole | null,
  options: {
    prefs?: Partial<ShopPreferences>;
    metadata?: Record<string, unknown>;
    userId?: string;
  } = {},
) {
  return resolveSessionActor({
    mode: "supabase",
    user: { id: options.userId ?? USER, email: "staff@example.com", user_metadata: options.metadata ?? {} } as never,
    email: "staff@example.com",
    preferences: prefs(options.prefs),
    shopMemberRole: membershipRole,
  });
}

describe("Phase 7 — privilege escalation", () => {
  it("1. cannot become owner through JWT/user metadata", () => {
    const actor = authActor("cashier", { metadata: { role: "owner", permissions: ["*"] } });
    expect(actor.role).toBe("cashier");
    expect(actor.role).not.toBe("owner");
    expect(resolveAuthRole({ mode: "supabase", userMetadata: { role: "owner" }, shopMemberRole: null }))
      .toBe(FAIL_CLOSED_ROLE);
  });

  it("2. cannot become manager by editing local state", () => {
    // A stale/forged local staff profile claiming manager does not move the actor
    // role; that comes from the membership row.
    const actor = authActor("waiter", {
      prefs: {
        staffAccounts: [
          { id: "s1", name: "Self", role: "manager", active: true, linkedAuthUserId: USER } as never,
        ],
      },
    });
    expect(actor.role).toBe("waiter");
    expect(hasActorPermission(actor.role, "reports.profit", actor.permissions)).toBe(false);
  });

  it("3/4. a client-side staff row cannot widen permissions beyond the membership role", () => {
    // The staff record claims an expanded custom role. The intersection with the
    // membership role's own set must strip everything the membership does not grant.
    const actor = authActor("waiter", {
      prefs: {
        staffAccounts: [
          {
            id: "s1",
            name: "Self",
            role: "manager",
            active: true,
            linkedAuthUserId: USER,
            customRoleId: "r1",
          } as never,
        ],
        customStaffRoles: [
          { id: "r1", name: "Everything", status: "active", permissions: permissionsForRole("owner") } as never,
        ],
      },
    });

    const waiterSet = new Set(permissionsForRole("waiter"));
    expect(actor.permissions?.length).toBeGreaterThan(0);
    for (const permission of actor.permissions ?? []) {
      expect(waiterSet.has(permission), `${permission} escaped the membership role`).toBe(true);
    }
    expect(hasActorPermission(actor.role, "stock.adjust", actor.permissions)).toBe(false);
    expect(hasActorPermission(actor.role, "reports.profit", actor.permissions)).toBe(false);
  });

  it("5. a restricted custom role stays restricted after Google sign-in", () => {
    // Owner restricted this staff member to two permissions.
    const restricted: Permission[] = ["pos.sell", "receipts.view"];
    const actor = authActor("cashier", {
      prefs: {
        staffAccounts: [
          { id: "s1", name: "Self", role: "cashier", active: true, linkedAuthUserId: USER, permissions: restricted } as never,
        ],
      },
    });

    expect(actor.permissions).toEqual(restricted);
    expect(hasActorPermission(actor.role, "pos.sell", actor.permissions)).toBe(true);
    // Everything the unrestricted cashier role would have had is gone.
    expect(hasActorPermission(actor.role, "sale_void", actor.permissions)).toBe(false);
    expect(hasActorPermission(actor.role, "customers.debt", actor.permissions)).toBe(false);
    expect(hasActorPermission(actor.role, "stock.count", actor.permissions)).toBe(false);
  });

  it("6. PIN staff and Auth staff with the same configuration resolve identically", () => {
    const configured = {
      id: "s1",
      name: "Staff",
      role: "cashier" as UserRole,
      active: true,
      linkedAuthUserId: USER,
      permissions: ["pos.sell", "receipts.view", "stock.count"] as Permission[],
    };

    const auth = authActor("cashier", { prefs: { staffAccounts: [configured as never] } });
    const pin = resolveSessionActor({
      mode: "supabase",
      user: null,
      email: null,
      preferences: prefs({ staffAccounts: [configured as never] }),
      staffSession: {
        staffId: "s1",
        staffName: "Staff",
        role: "cashier",
        permissions: configured.permissions,
        linkedAuthUserId: USER,
      },
    });

    expect(auth.permissions).toEqual(pin.permissions);
    for (const permission of configured.permissions) {
      expect(hasActorPermission(auth.role, permission, auth.permissions)).toBe(true);
      expect(hasActorPermission(pin.role, permission, pin.permissions)).toBe(true);
    }
  });

  it("12. removing the custom configuration cannot produce owner-level access", () => {
    const actor = authActor("cashier", {
      prefs: {
        staffAccounts: [
          { id: "s1", name: "Self", role: "cashier", active: true, linkedAuthUserId: USER, permissions: [] } as never,
        ],
      },
    });
    expect(actor.role).toBe("cashier");
    expect(hasActorPermission(actor.role, "reports.profit", actor.permissions)).toBe(false);
    expect(hasActorPermission(actor.role, "products.remove", actor.permissions)).toBe(false);
  });

  it("13. empty, null and invalid custom data fail safely", () => {
    const cases: unknown[] = [undefined, null, [], "not-an-array"];
    for (const permissions of cases) {
      const actor = authActor("cashier", {
        prefs: {
          staffAccounts: [
            { id: "s1", name: "Self", role: "cashier", active: true, linkedAuthUserId: USER, permissions } as never,
          ],
        },
      });
      // Falls back to the membership role's set — never to owner.
      expect(actor.role).toBe("cashier");
      expect(hasActorPermission(actor.role, "reports.profit", actor.permissions)).toBe(false);
    }
  });

  it("14. unknown roles fail closed", () => {
    expect(normalizeUserRole("superuser")).toBeNull();
    expect(normalizeUserRole("")).toBeNull();
    expect(normalizeUserRole(null)).toBeNull();
    const actor = authActor(null);
    expect(actor.role).toBe(FAIL_CLOSED_ROLE);
    expect(hasPermission(actor.role, "stock.adjust")).toBe(false);
  });
});

describe("Phase 7 — viewer role", () => {
  it("7. a viewer cannot perform inventory writes", () => {
    const role = normalizeUserRole("viewer");
    expect(role).toBe(FAIL_CLOSED_ROLE);

    const inventoryWrites: Permission[] = [
      "stock.adjust",
      "stock.count",
      "products.add",
      "products.remove",
      "products.edit_presets",
      "shelves.customize",
      "purchases.record",
      "purchases.void",
    ];
    for (const permission of inventoryWrites) {
      expect(hasPermission(role as UserRole, permission), `viewer gained ${permission}`).toBe(false);
    }
  });

  it("viewer resolves through the actor path to the least-privilege role", () => {
    // normalizeUserRole returns FAIL_CLOSED_ROLE directly, and resolveAuthRole
    // fails closed for anything it cannot resolve — both roads lead to the same
    // non-write role.
    const actor = authActor(FAIL_CLOSED_ROLE);
    expect(hasActorPermission(actor.role, "stock.adjust", actor.permissions)).toBe(false);
  });

  it("the membership → POS role mapping stays the pairing the invitation system sanctions", () => {
    // Recorded, not asserted as policy: the DB keeps 'viewer', Phase 3's sync
    // trigger maps it to POS 'cashier', and the client now maps it to the
    // least-privilege role. These are intentionally different layers — see the
    // Phase 7 report for the ambiguity this leaves for the product owner.
    expect(permissionsForRole("cashier")).toContain("stock.count");
    expect(permissionsForRole(FAIL_CLOSED_ROLE)).not.toContain("stock.count");
  });
});
