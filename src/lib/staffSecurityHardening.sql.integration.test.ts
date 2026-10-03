import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  attempt,
  callRpc,
  createStaffSecurityHarness,
  listStaff,
  seedStaffFixture,
  staffField,
  type SqlExec,
  type StaffFixture,
} from "../test/sqlIntegration/staffSecurityHardeningPgHarness";

/**
 * Phase 3 — staff security & credential protection (H1-H4, M2, M3).
 *
 * The first block runs against the PRE-migration schema and proves each finding
 * is real. Without it, every later "cannot" assertion would be vacuous.
 */

const T = 120_000;

describe("Phase 3 — pre-migration schema (findings are real)", () => {
  let exec: SqlExec;
  let f: StaffFixture;

  beforeAll(async () => {
    exec = await createStaffSecurityHarness({ applyPhase3: false });
    f = await seedStaffFixture(exec);
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  it("H3: a cashier can read every colleague's PIN and password hash", async () => {
    const rows = await listStaff(exec, f.cashierId, f.shopId);
    const manager = rows.find((r) => r.client_id === f.managerStaffClientId);
    expect(manager?.pin_hash).toBe("$2b$10$managerhash");
    expect(manager?.password_hash).toBe("$2b$10$managerpw");
  });

  it("H3: a viewer can read them too", async () => {
    const rows = await listStaff(exec, f.viewerId, f.shopId);
    expect(rows[0]?.pin_hash).toBeTruthy();
  });

  it("H4: a manager can rewrite security-sensitive staff columns directly", async () => {
    const wrote = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_pos_staff SET role = 'manager', user_id = $1, pin_hash = 'forged'
            WHERE shop_id = $2 AND client_id = $3 RETURNING id`,
          [f.viewerId, f.shopId, f.cashierStaffClientId],
        );
        return rows.length;
      }),
    );
    expect(wrote.ok).toBe(true);
    expect(wrote.ok === true ? wrote.value : 0).toBe(1);
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "pin_hash")).toBe("forged");
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "user_id")).toBe(f.viewerId);
  });

  it("M2: a null fingerprint satisfies the device check", async () => {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT public.shop_device_can_manage_staff ($1, null) AS ok`,
      [f.shopId],
    );
    expect(rows[0]?.ok).toBe(true);
  });

  it("M2: the 2-argument staff upsert overload exists", async () => {
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
        WHERE n2.nspname = 'public' AND p.proname = 'shop_pos_staff_upsert'
          AND pg_get_function_identity_arguments(p.oid) = 'p_shop_id uuid, p_row jsonb'`,
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("M3: a viewer on an approved device can clear a colleague's lockout", async () => {
    await exec.query(
      `UPDATE public.shop_pos_staff SET locked_until = now() + interval '1 hour', failed_pin_attempts = 5
        WHERE shop_id = $1 AND client_id = $2`,
      [f.shopId, f.cashierStaffClientId],
    );

    const res = await callRpc(
      exec,
      f.viewerId,
      `SELECT public.shop_pos_staff_unlock ($1,$2,$3) AS result`,
      [f.shopId, f.cashierStaffClientId, f.deviceFp],
    );
    expect(res.ok).toBe(true);
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "locked_until")).toBeNull();
  });

  it("H1: a disabled staff profile still has cloud access", async () => {
    await exec.query(
      `UPDATE public.shop_pos_staff SET is_active = false WHERE shop_id = $1 AND client_id = $2`,
      [f.shopId, f.cashierStaffClientId],
    );
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT public.user_can_access_shop ($1) AS ok FROM (SELECT set_config('request.jwt.claim.sub', $2, true)) s`,
      [f.shopId, f.cashierId],
    );
    expect(rows[0]?.ok).toBe(true);
  }, T);
});

describe("Phase 3 — after the hardening migration", () => {
  let exec: SqlExec;
  let f: StaffFixture;

  beforeAll(async () => {
    exec = await createStaffSecurityHarness({ applyPhase3: true });
    f = await seedStaffFixture(exec);
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  // ================= H3 =================
  it("H3-1/2/3/4. no member — cashier, viewer, manager or owner — sees a hash", async () => {
    for (const actor of [f.cashierId, f.viewerId, f.managerId, f.ownerId]) {
      const rows = await listStaff(exec, actor, f.shopId);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.pin_hash).toBeNull();
        expect(row.password_hash).toBeNull();
      }
    }
  }, T);

  it("H3-5. the hashes still exist server-side, so authentication keeps working", async () => {
    // The column is untouched — only the any-member read stopped returning it.
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "pin_hash")).toBe("$2b$10$cashierhash");
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "password_hash")).toBe("$2b$10$cashierpw");
  });

  it("H3-6. the staff list still returns the operational fields the UI needs", async () => {
    const rows = await listStaff(exec, f.managerId, f.shopId);
    const cashier = rows.find((r) => r.client_id === f.cashierStaffClientId);
    expect(cashier?.name).toBe("Cashier");
    expect(cashier?.role).toBe("cashier");
    expect(cashier?.is_active).toBe(true);
    expect(cashier?.user_id).toBe(f.cashierId);
    expect(cashier?.created_at).toBeTruthy();
  }, T);

  // ================= H4 =================
  it("H4-7..13. a manager cannot write any security-sensitive column directly", async () => {
    const statements: [string, string][] = [
      ["user_id", `UPDATE public.shop_pos_staff SET user_id = '${f.viewerId}' WHERE shop_id = $1 AND client_id = $2`],
      ["role", `UPDATE public.shop_pos_staff SET role = 'manager' WHERE shop_id = $1 AND client_id = $2`],
      ["permissions", `UPDATE public.shop_pos_staff SET permissions = '["admin.all"]'::jsonb WHERE shop_id = $1 AND client_id = $2`],
      ["email", `UPDATE public.shop_pos_staff SET email = 'attacker@example.test' WHERE shop_id = $1 AND client_id = $2`],
      ["shop_id", `UPDATE public.shop_pos_staff SET shop_id = $1 WHERE shop_id = $1 AND client_id = $2`],
      ["pin_hash", `UPDATE public.shop_pos_staff SET pin_hash = 'forged' WHERE shop_id = $1 AND client_id = $2`],
      ["password_hash", `UPDATE public.shop_pos_staff SET password_hash = 'forged' WHERE shop_id = $1 AND client_id = $2`],
      ["deleted_at", `UPDATE public.shop_pos_staff SET deleted_at = now() WHERE shop_id = $1 AND client_id = $2`],
    ];

    for (const [label, sql] of statements) {
      const result = await attempt(() =>
        asUser(exec, f.managerId, async () => {
          const { rows } = await exec.query<{ id: string }>(sql, [f.shopId, f.cashierStaffClientId]);
          return rows.length;
        }),
      );
      expect(result.ok === false || result.value === 0, `${label} was writable`).toBe(true);
    }

    // …and an INSERT is refused too.
    const insert = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `INSERT INTO public.shop_pos_staff (shop_id, name, role) VALUES ($1,'Injected','manager') RETURNING id`,
          [f.shopId],
        );
        return rows.length;
      }),
    );
    expect(insert.ok).toBe(false);

    // Nothing actually changed.
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "pin_hash")).toBe("$2b$10$cashierhash");
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "user_id")).toBe(f.cashierId);
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "role")).toBe("cashier");
  }, T);

  it("H4-13b. reads are preserved for members", async () => {
    const rows = await asUser(exec, f.managerId, async () => {
      const res = await exec.query<{ id: string }>(
        `SELECT id FROM public.shop_pos_staff WHERE shop_id = $1`,
        [f.shopId],
      );
      return res.rows;
    });
    expect(rows.length).toBe(2);
  }, T);

  // ================= H1 =================
  it("H1-17/18/19/20. active staff keep access; disabled and deleted lose it; reactivation restores it", async () => {
    expect(await accessOf(exec, f.cashierId, f.shopId)).toBe(true);

    await exec.query(`UPDATE public.shop_pos_staff SET is_active = false WHERE client_id = $1`, [
      f.cashierStaffClientId,
    ]);
    expect(await accessOf(exec, f.cashierId, f.shopId)).toBe(false);

    await exec.query(`UPDATE public.shop_pos_staff SET is_active = true WHERE client_id = $1`, [
      f.cashierStaffClientId,
    ]);
    expect(await accessOf(exec, f.cashierId, f.shopId)).toBe(true);

    await exec.query(`UPDATE public.shop_pos_staff SET deleted_at = now() WHERE client_id = $1`, [
      f.cashierStaffClientId,
    ]);
    expect(await accessOf(exec, f.cashierId, f.shopId)).toBe(false);

    await exec.query(`UPDATE public.shop_pos_staff SET deleted_at = null WHERE client_id = $1`, [
      f.cashierStaffClientId,
    ]);
    expect(await accessOf(exec, f.cashierId, f.shopId)).toBe(true);
  }, T);

  it("H1-21. an owner is never locked out by the staff lifecycle path", async () => {
    // Even with a disabled staff row of their own, the owner keeps access.
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO public.shop_pos_staff (shop_id, name, role, user_id, is_active)
       VALUES ($1,'Owner staff','manager',$2,false) RETURNING id`,
      [f.shopId, f.ownerId],
    );
    expect(rows.length).toBe(1);
    expect(await accessOf(exec, f.ownerId, f.shopId)).toBe(true);

    // A member with no staff row at all is likewise unaffected.
    expect(await accessOf(exec, f.viewerId, f.shopId)).toBe(true);
  }, T);

  it("H1-22. staff isolation holds across shops", async () => {
    // Disabling this shop's staff must not touch the other shop's members.
    expect(await accessOf(exec, f.ownerId, f.otherShopId)).toBe(true);
    expect(await accessOf(exec, f.cashierId, f.otherShopId)).toBe(false);
  }, T);

  // ================= M2 =================
  it("M2-23/24/25/26. device authority is explicit and fails closed", async () => {
    expect(await deviceCheck(exec, f.shopId, f.deviceFp)).toBe(true);
    expect(await deviceCheck(exec, f.shopId, "no-such-device")).toBe(false);
    expect(await deviceCheck(exec, f.shopId, null)).toBe(false);
    expect(await deviceCheck(exec, f.shopId, "")).toBe(false);
    expect(await deviceCheck(exec, f.shopId, "   ")).toBe(false);
    // A device approved for a different shop is not authority here.
    expect(await deviceCheck(exec, f.shopId, f.foreignDeviceFp)).toBe(false);
    // Unapproved / inactive devices are not authority.
    await exec.query(`UPDATE public.shop_devices SET status = 'inactive' WHERE device_fingerprint = $1`, [
      f.deviceFp,
    ]);
    expect(await deviceCheck(exec, f.shopId, f.deviceFp)).toBe(false);
    await exec.query(`UPDATE public.shop_devices SET status = 'active' WHERE device_fingerprint = $1`, [
      f.deviceFp,
    ]);
    expect(await deviceCheck(exec, f.shopId, f.deviceFp)).toBe(true);
  }, T);

  it("M2-25b. the 2-argument staff upsert overload is gone", async () => {
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
        WHERE n2.nspname = 'public' AND p.proname = 'shop_pos_staff_upsert'
          AND pg_get_function_identity_arguments(p.oid) = 'p_shop_id uuid, p_row jsonb'`,
    );
    expect(rows[0]?.n).toBe("0");
  });

  // ================= M3 =================
  it("M3-27/28/29/30. only a shop manager-equivalent may clear a lockout", async () => {
    const lock = async () => {
      await exec.query(
        `UPDATE public.shop_pos_staff SET locked_until = now() + interval '1 hour', failed_pin_attempts = 5
          WHERE shop_id = $1 AND client_id = $2`,
        [f.shopId, f.cashierStaffClientId],
      );
    };

    for (const actor of [f.cashierId, f.viewerId]) {
      await lock();
      const res = await attempt(() =>
        callRpc(exec, actor, `SELECT public.shop_pos_staff_unlock ($1,$2,$3) AS result`, [
          f.shopId,
          f.cashierStaffClientId,
          f.deviceFp,
        ]),
      );
      expect(res.ok, "unauthorised unlock was accepted").toBe(false);
      expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "locked_until")).not.toBeNull();
    }

    // The manager may, on an approved device…
    await lock();
    const manager = await callRpc(
      exec,
      f.managerId,
      `SELECT public.shop_pos_staff_unlock ($1,$2,$3) AS result`,
      [f.shopId, f.cashierStaffClientId, f.deviceFp],
    );
    expect(manager.ok).toBe(true);
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "locked_until")).toBeNull();

    // …but not from an unapproved device, and not with no fingerprint at all.
    await lock();
    const badDevice = await callRpc(
      exec,
      f.managerId,
      `SELECT public.shop_pos_staff_unlock ($1,$2,$3) AS result`,
      [f.shopId, f.cashierStaffClientId, "no-such-device"],
    );
    expect(badDevice.ok).toBe(false);
    expect(badDevice.error).toBe("device_not_authorized");

    const noDevice = await callRpc(
      exec,
      f.managerId,
      `SELECT public.shop_pos_staff_unlock ($1,$2,$3) AS result`,
      [f.shopId, f.cashierStaffClientId, null],
    );
    expect(noDevice.ok).toBe(false);
  }, T);

  // ================= H2 =================
  it("H2-14/15/16. membership role drives the POS role, never the reverse", async () => {
    // A POS role change cannot move cloud authority.
    await exec.query(`UPDATE public.shop_pos_staff SET role = 'manager' WHERE client_id = $1`, [
      f.cashierStaffClientId,
    ]);
    expect(await membershipRole(exec, f.shopId, f.cashierId)).toBe("cashier");
    expect(await accessOf(exec, f.cashierId, f.shopId)).toBe(true);

    // A membership role change mirrors onto the linked staff row, deterministically.
    await exec.query(`UPDATE public.shop_members SET role = 'viewer' WHERE shop_id = $1 AND user_id = $2`, [
      f.shopId,
      f.cashierId,
    ]);
    // 'viewer' has no POS equivalent; it maps to 'cashier' — the pairing the
    // invitation system already sanctions (membership viewer + pos cashier).
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "role")).toBe("cashier");

    await exec.query(`UPDATE public.shop_members SET role = 'waiter' WHERE shop_id = $1 AND user_id = $2`, [
      f.shopId,
      f.cashierId,
    ]);
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "role")).toBe("waiter");

    await exec.query(`UPDATE public.shop_members SET role = 'manager' WHERE shop_id = $1 AND user_id = $2`, [
      f.shopId,
      f.cashierId,
    ]);
    expect(await staffField(exec, f.shopId, f.cashierStaffClientId, "role")).toBe("manager");

    // Every mirrored value satisfies the POS role check constraint.
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.shop_pos_staff
        WHERE role not in ('manager','cashier','stock_keeper','supervisor','waiter','kitchen','bar')`,
    );
    expect(rows[0]?.n).toBe("0");
  }, T);

  it("H2-16b. an owner membership never mirrors a POS role", async () => {
    // The owner has a staff row (created in H1-21); promoting someone to owner is
    // blocked by Phase 2, so the sync path must simply never emit 'owner'.
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.shop_pos_staff WHERE role = 'owner'`,
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("the migration is safe to re-apply", async () => {
    const { phase3MigrationSql } = await import("../test/sqlIntegration/staffSecurityHardeningPgHarness");
    await exec.exec(phase3MigrationSql());
    expect(await deviceCheck(exec, f.shopId, null)).toBe(false);
    const rows = await listStaff(exec, f.managerId, f.shopId);
    expect(rows[0]?.pin_hash).toBeNull();
  }, T);
});

/** user_can_access_shop() for a user, evaluated with that user's identity. */
async function accessOf(exec: SqlExec, userId: string, shopId: string): Promise<boolean> {
  return asUser(exec, userId, async () => {
    const { rows } = await exec.query<{ ok: boolean }>(
      `SELECT public.user_can_access_shop ($1) AS ok`,
      [shopId],
    );
    return rows[0]?.ok === true;
  });
}

async function deviceCheck(exec: SqlExec, shopId: string, fp: string | null): Promise<boolean> {
  const { rows } = await exec.query<{ ok: boolean }>(
    `SELECT public.shop_device_can_manage_staff ($1, $2) AS ok`,
    [shopId, fp],
  );
  return rows[0]?.ok === true;
}

async function membershipRole(exec: SqlExec, shopId: string, userId: string): Promise<string | null> {
  const { rows } = await exec.query<{ role: string }>(
    `SELECT role FROM public.shop_members WHERE shop_id = $1 AND user_id = $2`,
    [shopId, userId],
  );
  return rows[0]?.role ?? null;
}
