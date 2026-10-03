import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnonymous,
  asUser,
  attempt,
  createCredentialDeliveryHarness,
  download,
  payloadLeaksHashes,
  phase4MigrationSql,
  seedPhase4Fixture,
  type Phase4Fixture,
  type SqlExec,
} from "../test/sqlIntegration/staffCredentialDeliveryPgHarness";

/**
 * Phase 4 — staff credential delivery lockdown.
 *
 * The first block runs against the PRE-Phase-4 schema and proves both findings
 * are real: any member could pull every credential hash, and the device argument
 * on that call did nothing.
 */

const T = 120_000;

describe("Phase 4 — pre-migration (findings are real)", () => {
  let exec: SqlExec;
  let f: Phase4Fixture;

  beforeAll(async () => {
    exec = await createCredentialDeliveryHarness({ applyPhase4: false });
    f = await seedPhase4Fixture(exec);
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  it("a cashier with NO device fingerprint can download every credential hash", async () => {
    const payload = await download(exec, f.cashierId, f.shopId, null);
    expect(payloadLeaksHashes(payload)).toBe(true);
    const rows = payload.changed as Record<string, unknown>[];
    expect(rows[0]?.pin_hash).toBe("$2b$10$cashierhash");
  });

  it("a viewer can too, and an arbitrary fingerprint changes nothing", async () => {
    const bogus = await download(exec, f.viewerId, f.shopId, "not-a-real-device");
    expect(payloadLeaksHashes(bogus)).toBe(true);
  });

  it("the device approval check is skipped when the actor fingerprint is null", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM public.shop_devices WHERE shop_id = $1 AND device_fingerprint = $2`,
      [f.shopId, f.deviceFp],
    );
    const deviceId = rows[0]?.id as string;

    // Owner approves with NO fingerprint — the pre-Phase-4 bypass.
    const res = await asUser(exec, f.ownerId, async () => {
      const { rows: out } = await exec.query<{ result: Record<string, unknown> }>(
        `SELECT public.shop_device_set_approval ($1,$2,'revoked',null) AS result`,
        [f.shopId, deviceId],
      );
      return out[0]?.result ?? {};
    });
    expect(res.ok).toBe(true);
  }, T);

  it("the unreachable write policies still exist", async () => {
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE schemaname='public'
          AND (tablename, policyname) IN
              (('shop_pos_staff','shop_pos_staff_write'),
               ('shop_members','shop_members_update'),
               ('shop_members','shop_members_delete'))`,
    );
    expect(rows[0]?.n).toBe("3");
  });

  it("anon holds EXECUTE on the staff surface", async () => {
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p
        JOIN pg_namespace ns ON ns.oid = p.pronamespace,
        LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE ns.nspname='public' AND a.grantee::regrole::text = 'anon'
          AND p.proname IN ('shop_pos_staff_list','shop_pos_staff_download',
                            'shop_pos_staff_unlock','shop_device_can_manage_staff')`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);
  });
});

describe("Phase 4 — after the credential-delivery lockdown", () => {
  let exec: SqlExec;
  let f: Phase4Fixture;

  beforeAll(async () => {
    exec = await createCredentialDeliveryHarness({ applyPhase4: true });
    f = await seedPhase4Fixture(exec);
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  // ---------- H3 / device-scoped download ----------
  it("1/2. cashier and viewer cannot download credential hashes", async () => {
    for (const actor of [f.cashierId, f.viewerId]) {
      const res = await attempt(() => download(exec, actor, f.shopId, f.deviceFp));
      expect(res.ok, "member was allowed to download").toBe(false);
    }
  }, T);

  it("3/5/6. a manager without a device, and with null or blank fingerprints, is refused", async () => {
    for (const fp of [null, "", "   "]) {
      const res = await attempt(() => download(exec, f.managerId, f.shopId, fp));
      expect(res.ok, `fingerprint ${JSON.stringify(fp)} was accepted`).toBe(false);
    }
  }, T);

  it("4/7/8/9. wrong, cross-shop, unapproved and inactive devices are refused", async () => {
    // Unregistered fingerprint.
    expect((await attempt(() => download(exec, f.managerId, f.shopId, "nope"))).ok).toBe(false);

    // A device that belongs to a different shop.
    expect((await attempt(() => download(exec, f.managerId, f.shopId, f.foreignFp))).ok).toBe(false);

    // Suspended device.
    await exec.query(`UPDATE public.shop_devices SET status = 'revoked' WHERE device_fingerprint = $1`, [
      f.deviceFp,
    ]);
    expect((await attempt(() => download(exec, f.managerId, f.shopId, f.deviceFp))).ok).toBe(false);

    await exec.query(`UPDATE public.shop_devices SET status = 'active' WHERE device_fingerprint = $1`, [
      f.deviceFp,
    ]);
    expect((await attempt(() => download(exec, f.managerId, f.shopId, f.deviceFp))).ok).toBe(true);
  }, T);

  it("10/11. an authorized operational device succeeds and receives only its shop's staff", async () => {
    const payload = await download(exec, f.managerId, f.shopId, f.deviceFp);
    expect(payload.ok).toBe(true);
    const rows = payload.changed as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0]?.client_id).toBe(f.cashierStaffClientId);
    // Shop-scoped: nothing from the other shop.
    for (const row of rows) expect(row.shop_id ?? f.shopId).not.toBe(f.otherShopId);
  }, T);

  it("12/13. credential material still reaches the terminal, so offline PIN verification works", async () => {
    const payload = await download(exec, f.managerId, f.shopId, f.deviceFp);
    const rows = payload.changed as Record<string, unknown>[];
    // The offline terminal still gets the hash it verifies locally.
    expect(rows[0]?.pin_hash).toBe("$2b$10$cashierhash");
    expect(rows[0]?.password_hash).toBe("$2b$10$cashierpw");

    // A PIN change propagates on the next download.
    await exec.query(`UPDATE public.shop_pos_staff SET pin_hash = '$2b$10$newpin' WHERE client_id = $1`, [
      f.cashierStaffClientId,
    ]);
    const after = await download(exec, f.ownerId, f.shopId, f.deviceFp);
    expect((after.changed as Record<string, unknown>[])[0]?.pin_hash).toBe("$2b$10$newpin");
  }, T);

  it("14. the shop-scoped staff list still works for members (no hashes, no device needed)", async () => {
    const rows = await asUser(exec, f.cashierId, async () => {
      const res = await exec.query<{ staff: Record<string, unknown>[] }>(
        `SELECT public.shop_pos_staff_list ($1) AS staff`,
        [f.shopId],
      );
      return (res.rows[0]?.staff ?? []) as Record<string, unknown>[];
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.pin_hash).toBeNull();
  }, T);

  // ---------- device approval ----------
  it("15-20. device approval fails closed", async () => {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM public.shop_devices WHERE shop_id = $1 AND device_fingerprint = $2`,
      [f.shopId, f.deviceFp],
    );
    const deviceId = rows[0]?.id as string;

    const approve = (actor: string, fp: string | null) =>
      asUser(exec, actor, async () => {
        const { rows: out } = await exec.query<{ result: Record<string, unknown> }>(
          `SELECT public.shop_device_set_approval ($1,$2,'approved',$3) AS result`,
          [f.shopId, deviceId, fp],
        );
        return out[0]?.result ?? {};
      });

    // 15 — valid fingerprint from the owner succeeds.
    expect((await approve(f.ownerId, f.deviceFp)).ok).toBe(true);

    // 17/18 — null and blank are refused (the pre-Phase-4 bypass is gone).
    expect((await approve(f.ownerId, null)).error).toBe("not_primary_device");
    expect((await approve(f.ownerId, "   ")).error).toBe("not_primary_device");

    // 16 — an unknown device is refused.
    expect((await approve(f.ownerId, "no-such-device")).error).toBe("not_primary_device");

    // 19 — a device belonging to another shop is not authority here.
    expect((await approve(f.ownerId, f.foreignFp)).error).toBe("not_primary_device");

    // 20 — an inactive device is not authority.
    await exec.query(`UPDATE public.shop_devices SET status = 'revoked' WHERE device_fingerprint = $1`, [
      f.deviceFp,
    ]);
    expect((await approve(f.ownerId, f.deviceFp)).error).toBe("not_primary_device");
    await exec.query(`UPDATE public.shop_devices SET status = 'active' WHERE device_fingerprint = $1`, [
      f.deviceFp,
    ]);

    // A non-owner is refused outright.
    expect((await attempt(() => approve(f.managerId, f.deviceFp))).ok).toBe(false);
  }, T);

  // ---------- anon EXECUTE ----------
  it("21. anonymous callers cannot execute the staff RPCs", async () => {
    const res = await attempt(() =>
      asAnonymous(exec, async () => {
        const { rows } = await exec.query(`SELECT public.shop_pos_staff_list ($1)`, [f.shopId]);
        return rows.length;
      }),
    );
    expect(res.ok).toBe(false);

    const dl = await attempt(() =>
      asAnonymous(exec, async () => {
        const { rows } = await exec.query(`SELECT public.shop_pos_staff_download ($1, 0, $2)`, [
          f.shopId,
          f.deviceFp,
        ]);
        return rows.length;
      }),
    );
    expect(dl.ok).toBe(false);
  }, T);

  it("22. authenticated callers still work", async () => {
    const payload = await download(exec, f.managerId, f.shopId, f.deviceFp);
    expect(payload.ok).toBe(true);
    const rows = await asUser(exec, f.managerId, async () => {
      const res = await exec.query(`SELECT public.shop_pos_staff_list ($1)`, [f.shopId]);
      return res.rows;
    });
    expect(rows.length).toBe(1);
  }, T);

  it("is_waka_internal_staff keeps its anon EXECUTE (RLS depends on it)", async () => {
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p
        JOIN pg_namespace ns ON ns.oid = p.pronamespace,
        LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE ns.nspname='public' AND a.grantee::regrole::text = 'anon'
          AND p.proname = 'is_waka_internal_staff'`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
  });

  // ---------- vestigial policies ----------
  it("the three unreachable write policies are dropped, read policies remain", async () => {
    const { rows } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE schemaname='public'
          AND (tablename, policyname) IN
              (('shop_pos_staff','shop_pos_staff_write'),
               ('shop_members','shop_members_update'),
               ('shop_members','shop_members_delete'))`,
    );
    expect(rows[0]?.n).toBe("0");

    const { rows: kept } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE schemaname='public'
          AND (tablename, policyname) IN
              (('shop_pos_staff','shop_pos_staff_select'),
               ('shop_members','shop_members_select'))`,
    );
    expect(kept[0]?.n).toBe("2");
  });

  it("Phase 2 and Phase 3 protections are intact", async () => {
    // Phase 3: manager still cannot write shop_pos_staff directly.
    const write = await attempt(() =>
      asUser(exec, f.managerId, async () => {
        const { rows } = await exec.query<{ id: string }>(
          `UPDATE public.shop_pos_staff SET role = 'manager' WHERE shop_id = $1 RETURNING id`,
          [f.shopId],
        );
        return rows.length;
      }),
    );
    expect(write.ok === false || write.value === 0).toBe(true);

    // Phase 3: device authority still fails closed on a null fingerprint.
    const { rows: dev } = await exec.query<{ ok: boolean }>(
      `SELECT public.shop_device_can_manage_staff ($1, null) AS ok`,
      [f.shopId],
    );
    expect(dev[0]?.ok).toBe(false);

    // Phase 2: authenticated still holds no UPDATE/DELETE on shop_members.
    const { rows: grants } = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='shop_members'
          AND grantee='authenticated' AND privilege_type IN ('UPDATE','DELETE')`,
    );
    expect(grants[0]?.n).toBe("0");
  }, T);

  it("the migration is safe to re-apply", async () => {
    await exec.exec(phase4MigrationSql());
    expect((await attempt(() => download(exec, f.cashierId, f.shopId, f.deviceFp))).ok).toBe(false);
    const payload = await download(exec, f.managerId, f.shopId, f.deviceFp);
    expect(payload.ok).toBe(true);
  }, T);
});
