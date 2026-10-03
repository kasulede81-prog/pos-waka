import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attempt,
  asUser,
  auditActions,
  auditRow,
  callRpc,
  createShopMembershipLockdownHarness,
  memberCount,
  roleOf,
  seedMembershipFixture,
  type MembershipFixture,
  type SqlExec,
} from "../test/sqlIntegration/shopMembershipLockdownPgHarness";

/**
 * Phase 2 — shop membership lockdown (C1, the manager takeover).
 *
 * C1 as confirmed against live production by the Phase 1 reconciliation:
 * `authenticated` held UPDATE and DELETE on public.shop_members, both policies
 * were gated only by user_can_manage_shop() (true for owner AND manager), and
 * trg_shop_members_single_owner fired only BEFORE INSERT OR UPDATE OF role —
 * never on DELETE, and it passed immediately whenever the new role was not
 * 'owner'. A manager could therefore delete the owner's row and then update
 * their own row to 'owner'.
 *
 * The first describe block proves that path is real against the pre-migration
 * schema. Without it, every later "manager cannot…" assertion would be vacuous.
 */

const T = 120_000;

const LOCKDOWN_MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261003000000_shop_membership_lockdown.sql",
);

describe("C1 attack path — pre-migration schema (proves the vulnerability is real)", () => {
  let exec: SqlExec;
  let f: MembershipFixture;

  beforeAll(async () => {
    exec = await createShopMembershipLockdownHarness({ applyLockdown: false });
    f = await seedMembershipFixture(exec);
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  it("lets a manager delete the owner's membership and promote themselves to owner", async () => {
    // Step 1 — delete the owner. The delete policy admits the manager and no
    // trigger fires on DELETE.
    const deleted = await asUser(exec, f.managerId, async () => {
      const { rows } = await exec.query<{ id: string }>(
        `DELETE FROM public.shop_members WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
        [f.shopId, f.ownerId],
      );
      return rows.length;
    });
    expect(deleted).toBe(1);

    // Step 2 — promote self. No other owner remains, so the single-owner trigger passes.
    const promoted = await asUser(exec, f.managerId, async () => {
      const { rows } = await exec.query<{ id: string }>(
        `UPDATE public.shop_members SET role = 'owner' WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
        [f.shopId, f.managerId],
      );
      return rows.length;
    });
    expect(promoted).toBe(1);

    expect(await roleOf(exec, f.shopId, f.ownerId)).toBeNull();
    expect(await roleOf(exec, f.shopId, f.managerId)).toBe("owner");
  }, T);

  it("lets a manager demote the owner in one step", async () => {
    const demoted = await asUser(exec, f.managerId, async () => {
      const { rows } = await exec.query<{ id: string }>(
        `UPDATE public.shop_members SET role = 'cashier' WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
        [f.shopId, f.managerId],
      );
      return rows.length;
    });
    // The manager row was promoted to owner by the previous test, and the trigger
    // only inspects rows whose NEW role is 'owner' — so demoting an owner is allowed.
    expect(demoted).toBe(1);
    expect(await roleOf(exec, f.shopId, f.managerId)).toBe("cashier");
  }, T);
});

describe("Phase 2 lockdown — membership mutation matrix", () => {
  let exec: SqlExec;
  let f: MembershipFixture;

  beforeAll(async () => {
    exec = await createShopMembershipLockdownHarness({ applyLockdown: true });
    f = await seedMembershipFixture(exec);
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  // ---------- 1. manager cannot delete the owner ----------
  it("1. manager cannot delete the owner's membership", async () => {
    const result = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `DELETE FROM public.shop_members WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
          [f.shopId, f.ownerId],
        );
        return rows.length;
      }),
    );
    // Either the privilege is denied outright, or RLS filters the row away.
    expect(result.ok === false || result.value === 0).toBe(true);
    expect(await roleOf(exec, f.shopId, f.ownerId)).toBe("owner");
  }, T);

  // ---------- 2. manager cannot demote the owner ----------
  it("2. manager cannot demote the owner", async () => {
    const result = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_members SET role = 'cashier' WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
          [f.shopId, f.ownerId],
        );
        return rows.length;
      }),
    );
    expect(result.ok === false || result.value === 0).toBe(true);
    expect(await roleOf(exec, f.shopId, f.ownerId)).toBe("owner");
  }, T);

  // ---------- 3. manager cannot promote themselves ----------
  it("3. manager cannot promote themselves to owner", async () => {
    const result = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_members SET role = 'owner' WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
          [f.shopId, f.managerId],
        );
        return rows.length;
      }),
    );
    expect(result.ok === false || result.value === 0).toBe(true);
    expect(await roleOf(exec, f.shopId, f.managerId)).toBe("manager");

    // …and not through the controlled RPC either.
    const rpc = await callRpc(
      exec,
      f.managerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.managerId, "owner"],
    );
    expect(rpc.ok).toBe(false);
    expect(await roleOf(exec, f.shopId, f.managerId)).toBe("manager");
  }, T);

  // ---------- 4. manager cannot change another member's role ----------
  it("4. manager cannot change another member's role", async () => {
    const direct = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_members SET role = 'viewer' WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
          [f.shopId, f.cashierId],
        );
        return rows.length;
      }),
    );
    expect(direct.ok === false || direct.value === 0).toBe(true);

    const rpc = await callRpc(
      exec,
      f.managerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.cashierId, "viewer"],
    );
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toBe("not_shop_owner");
    expect(await roleOf(exec, f.shopId, f.cashierId)).toBe("cashier");
  }, T);

  // ---------- 5. manager cannot move shop_id ----------
  it("5. manager cannot change a membership's shop_id", async () => {
    const result = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_members SET shop_id = $1 WHERE shop_id = $2 AND user_id = $3 RETURNING id`,
          [f.otherShopId, f.shopId, f.cashierId],
        );
        return rows.length;
      }),
    );
    expect(result.ok === false || result.value === 0).toBe(true);
    expect(await roleOf(exec, f.shopId, f.cashierId)).toBe("cashier");
  }, T);

  // ---------- 6. manager cannot move user_id ----------
  it("6. manager cannot change a membership's user_id", async () => {
    const result = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_members SET user_id = $1 WHERE shop_id = $2 AND user_id = $3 RETURNING id`,
          [f.outsiderId, f.shopId, f.cashierId],
        );
        return rows.length;
      }),
    );
    expect(result.ok === false || result.value === 0).toBe(true);
    expect(await roleOf(exec, f.shopId, f.cashierId)).toBe("cashier");
    expect(await roleOf(exec, f.shopId, f.outsiderId)).toBeNull();
  }, T);

  // ---------- 7 & 8. cashier / viewer cannot mutate ----------
  it.each([
    ["7. cashier", "cashierId" as const],
    ["8. viewer", "viewerId" as const],
  ])("%s cannot mutate membership", async (_label, actorKey) => {
    const actorId = f[actorKey];

    const deletes = await attempt(() =>
      asUser(exec, actorId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `DELETE FROM public.shop_members WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
          [f.shopId, f.cashierId],
        );
        return rows.length;
      }),
    );
    expect(deletes.ok === false || deletes.value === 0).toBe(true);

    const updates = await attempt(() =>
      asUser(exec, actorId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_members SET role = 'manager' WHERE shop_id = $1 AND user_id = $2 RETURNING id`,
          [f.shopId, f.cashierId],
        );
        return rows.length;
      }),
    );
    expect(updates.ok === false || updates.value === 0).toBe(true);

    const rpc = await callRpc(
      exec,
      actorId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.cashierId, "manager"],
    );
    expect(rpc.ok).toBe(false);
    expect(rpc.error).toBe("not_shop_owner");

    const remove = await callRpc(
      exec,
      actorId,
      `SELECT public.shop_remove_member ($1, $2) AS result`,
      [f.shopId, f.viewerId],
    );
    expect(remove.ok).toBe(false);

    expect(await roleOf(exec, f.shopId, f.cashierId)).toBe("cashier");
  }, T);

  // ---------- 9. owner can change an allowed role ----------
  it("9. owner can change an allowed member role, and it is audited", async () => {
    const before = await memberCount(exec, f.shopId);

    const rpc = await callRpc(
      exec,
      f.ownerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.cashierId, "waiter"],
    );
    expect(rpc.ok).toBe(true);
    expect(rpc.changed).toBe(true);
    expect(rpc.previous_role).toBe("cashier");
    expect(rpc.role).toBe("waiter");
    expect(await roleOf(exec, f.shopId, f.cashierId)).toBe("waiter");
    expect(await memberCount(exec, f.shopId)).toBe(before);

    const audit = await auditRow(exec, f.shopId, "member_role_changed");
    expect(audit).not.toBeNull();
    expect(audit?.actor_user_id).toBe(f.ownerId);
    expect(audit?.payload).toMatchObject({
      target_user_id: f.cashierId,
      old_role: "cashier",
      new_role: "waiter",
    });
  }, T);

  // ---------- 10. owner can remove an allowed member ----------
  it("10. owner can remove an allowed member, and it is audited", async () => {
    const rpc = await callRpc(
      exec,
      f.ownerId,
      `SELECT public.shop_remove_member ($1, $2) AS result`,
      [f.shopId, f.viewerId],
    );
    expect(rpc.ok).toBe(true);
    expect(rpc.removed_role).toBe("viewer");
    expect(await roleOf(exec, f.shopId, f.viewerId)).toBeNull();

    const audit = await auditRow(exec, f.shopId, "member_removed");
    expect(audit).not.toBeNull();
    expect(audit?.actor_user_id).toBe(f.ownerId);
    expect(audit?.payload).toMatchObject({ target_user_id: f.viewerId, removed_role: "viewer" });
  }, T);

  // ---------- 11. the owner cannot be deleted or demoted ----------
  it("11. owner cannot delete or demote the only owner", async () => {
    const remove = await callRpc(
      exec,
      f.ownerId,
      `SELECT public.shop_remove_member ($1, $2) AS result`,
      [f.shopId, f.ownerId],
    );
    expect(remove.ok).toBe(false);
    expect(remove.error).toBe("owner_protected");

    const demote = await callRpc(
      exec,
      f.ownerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.ownerId, "manager"],
    );
    expect(demote.ok).toBe(false);
    expect(demote.error).toBe("owner_protected");

    // The role-change path cannot mint a second owner either.
    const transfer = await callRpc(
      exec,
      f.ownerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.managerId, "owner"],
    );
    expect(transfer.ok).toBe(false);
    expect(transfer.error).toBe("invalid_role");

    // And the trigger still backstops a direct demotion from privileged SQL.
    const direct = await attempt(() =>
      exec.query(`UPDATE public.shop_members SET role = 'manager' WHERE shop_id = $1 AND user_id = $2`, [
        f.shopId,
        f.ownerId,
      ]),
    );
    expect(direct.ok).toBe(false);
    expect(String(direct.ok === false ? direct.error : "")).toMatch(/shop_owner_protected/);

    expect(await roleOf(exec, f.shopId, f.ownerId)).toBe("owner");
  }, T);

  // ---------- 12. cross-shop mutation fails ----------
  it("12. cross-shop mutation fails", async () => {
    // Owner of shop A cannot name a member who only belongs to shop B.
    const foreignTarget = await callRpc(
      exec,
      f.ownerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.outsiderId, "viewer"],
    );
    expect(foreignTarget.ok).toBe(false);
    expect(foreignTarget.error).toBe("member_not_found");

    // Owner of shop B cannot act on shop A at all.
    const foreignActor = await callRpc(
      exec,
      f.outsiderId,
      `SELECT public.shop_remove_member ($1, $2) AS result`,
      [f.shopId, f.managerId],
    );
    expect(foreignActor.ok).toBe(false);
    expect(foreignActor.error).toBe("not_shop_owner");

    // Shop B is untouched throughout.
    expect(await roleOf(exec, f.otherShopId, f.outsiderId)).toBe("owner");
    expect(await roleOf(exec, f.shopId, f.managerId)).toBe("manager");
  }, T);

  // ---------- 14. no audit and no change on rejection ----------
  it("14. a rejected mutation changes nothing and writes no audit row", async () => {
    const before = await auditActions(exec, f.shopId);
    const rolesBefore = {
      owner: await roleOf(exec, f.shopId, f.ownerId),
      manager: await roleOf(exec, f.shopId, f.managerId),
      cashier: await roleOf(exec, f.shopId, f.cashierId),
    };

    for (const actor of [f.managerId, f.cashierId, f.outsiderId]) {
      await callRpc(exec, actor, `SELECT public.shop_set_member_role ($1, $2, $3) AS result`, [
        f.shopId,
        f.ownerId,
        "manager",
      ]);
      await callRpc(exec, actor, `SELECT public.shop_set_member_role ($1, $2, $3) AS result`, [
        f.shopId,
        f.managerId,
        "owner",
      ]);
      await callRpc(exec, actor, `SELECT public.shop_remove_member ($1, $2) AS result`, [
        f.shopId,
        f.ownerId,
      ]);
    }

    expect(await auditActions(exec, f.shopId)).toEqual(before);
    expect(await roleOf(exec, f.shopId, f.ownerId)).toBe(rolesBefore.owner);
    expect(await roleOf(exec, f.shopId, f.managerId)).toBe(rolesBefore.manager);
    expect(await roleOf(exec, f.shopId, f.cashierId)).toBe(rolesBefore.cashier);
  }, T);

  // ---------- anonymous callers ----------
  it("anon cannot mutate membership and cannot execute the RPCs", async () => {
    const result = await attempt(() =>
      callRpc(exec, null, `SELECT public.shop_remove_member ($1, $2) AS result`, [
        f.shopId,
        f.managerId,
      ]),
    );
    expect(result.ok).toBe(false);

    const direct = await attempt(() =>
      callRpc(exec, null, `SELECT public.shop_set_member_role ($1, $2, $3) AS result`, [
        f.shopId,
        f.managerId,
        "owner",
      ]),
    );
    expect(direct.ok).toBe(false);

    expect(await roleOf(exec, f.shopId, f.managerId)).toBe("manager");
  }, T);

  // ---------- reads are preserved ----------
  it("membership reads still work for members after the revoke", async () => {
    const rows = await asUser(exec, f.managerId, async () => {
      const res = await exec.query<{ user_id: string; role: string }>(
        `SELECT user_id, role FROM public.shop_members WHERE shop_id = $1`,
        [f.shopId],
      );
      return res.rows;
    });
    // owner + manager + the member test 9 promoted from cashier to waiter;
    // the viewer was removed in test 10.
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.role).sort()).toEqual(["manager", "owner", "waiter"]);
  }, T);

  // ---------- re-runnability ----------
  it("the migration is safe to re-apply", async () => {
    const sql = readFileSync(LOCKDOWN_MIGRATION, "utf8");
    await exec.exec(sql);

    // Privileges are still closed and the trigger still guards the owner.
    expect(await roleOf(exec, f.shopId, f.ownerId)).toBe("owner");

    const demote = await attempt(() =>
      exec.query(`UPDATE public.shop_members SET role = 'manager' WHERE shop_id = $1 AND user_id = $2`, [
        f.shopId,
        f.ownerId,
      ]),
    );
    expect(demote.ok).toBe(false);

    const managerRpc = await callRpc(
      exec,
      f.managerId,
      `SELECT public.shop_set_member_role ($1, $2, $3) AS result`,
      [f.shopId, f.cashierId, "viewer"],
    );
    expect(managerRpc.ok).toBe(false);
    expect(managerRpc.error).toBe("not_shop_owner");
  }, T);
});
