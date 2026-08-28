import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEfrisSqlHarness,
  efrisRpc,
  seedEfrisFixture,
  type EfrisSqlFixture,
} from "../../test/sqlIntegration/efrisPgHarness";
import { asUser, type SqlExec } from "../../test/sqlIntegration/transferEnginePgHarness";

describe("EFRIS Phase 1 — SQL outbox + RLS RPCs (migration 169)", () => {
  let exec: SqlExec;
  let fx: EfrisSqlFixture;

  beforeAll(async () => {
    exec = await createEfrisSqlHarness();
    fx = await seedEfrisFixture(exec);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  async function rpc(userId: string, sql: string, params: unknown[] = []) {
    return asUser(exec, userId, async () => {
      const { rows } = await exec.query(sql, params);
      return efrisRpc(rows[0]);
    });
  }

  async function countOutbox(shopId: string, saleId: string): Promise<number> {
    const { rows } = await exec.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM public.shop_efris_submissions WHERE shop_id = $1 AND sale_id = $2`,
      [shopId, saleId],
    );
    return Number(rows[0]!.c);
  }

  it("defaults to disabled (no config row) and does not create an outbox", async () => {
    const saleId = crypto.randomUUID();
    const cfg = await rpc(fx.userAId, `SELECT public.shop_get_efris_config($1::uuid) AS result`, [fx.shopAId]);
    expect(cfg.ok).toBe(true);
    expect(cfg.enabled).toBe(false);

    const enq = await rpc(
      fx.cashierAId,
      `SELECT public.shop_enqueue_efris_submission($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(enq).toMatchObject({ ok: true, enqueued: false, efris_state: "NOT_REQUIRED" });
    expect(await countOutbox(fx.shopAId, saleId)).toBe(0);
  });

  it("creates exactly one PENDING row when enabled, and is idempotent", async () => {
    const saleId = crypto.randomUUID();
    const enabled = await rpc(fx.userAId, `SELECT public.shop_set_efris_enabled($1::uuid, true) AS result`, [
      fx.shopAId,
    ]);
    expect(enabled).toMatchObject({ ok: true, enabled: true });
    expect(enabled.connection_status).not.toBe("connected");

    const first = await rpc(
      fx.cashierAId,
      `SELECT public.shop_enqueue_efris_submission($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(first).toMatchObject({ ok: true, enqueued: true, efris_state: "PENDING", created: true });

    const second = await rpc(
      fx.cashierAId,
      `SELECT public.shop_enqueue_efris_submission($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(second).toMatchObject({ ok: true, enqueued: true, efris_state: "PENDING", created: false });
    expect(second.id).toBe(first.id);
    expect(await countOutbox(fx.shopAId, saleId)).toBe(1);
  });

  it("blocks Shop B from reading Shop A config or enqueueing Shop A sales", async () => {
    const saleId = crypto.randomUUID();
    const cfg = await rpc(fx.userBId, `SELECT public.shop_get_efris_config($1::uuid) AS result`, [fx.shopAId]);
    expect(cfg.ok).toBe(false);
    expect(cfg.error).toBe("forbidden");

    const enq = await rpc(
      fx.userBId,
      `SELECT public.shop_enqueue_efris_submission($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(enq.ok).toBe(false);
    expect(enq.error).toBe("forbidden");
    expect(await countOutbox(fx.shopAId, saleId)).toBe(0);

    const outsider = await rpc(fx.outsiderId, `SELECT public.shop_get_efris_config($1::uuid) AS result`, [
      fx.shopAId,
    ]);
    expect(outsider.error).toBe("forbidden");
  });

  it("does not let a cashier enable EFRIS; manager can disable without deleting historical outbox", async () => {
    const saleId = crypto.randomUUID();
    await rpc(fx.userAId, `SELECT public.shop_set_efris_enabled($1::uuid, true) AS result`, [fx.shopAId]);
    const enq = await rpc(
      fx.cashierAId,
      `SELECT public.shop_enqueue_efris_submission($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(enq.enqueued).toBe(true);

    const denied = await rpc(fx.cashierAId, `SELECT public.shop_set_efris_enabled($1::uuid, false) AS result`, [
      fx.shopAId,
    ]);
    expect(denied.error).toBe("forbidden");

    const disabled = await rpc(fx.userAId, `SELECT public.shop_set_efris_enabled($1::uuid, false) AS result`, [
      fx.shopAId,
    ]);
    expect(disabled.enabled).toBe(false);
    expect(await countOutbox(fx.shopAId, saleId)).toBe(1);

    const { rows } = await exec.query<{ efris_state: string }>(
      `SELECT efris_state FROM public.shop_efris_submissions WHERE shop_id = $1 AND sale_id = $2`,
      [fx.shopAId, saleId],
    );
    expect(rows[0]!.efris_state).toBe("PENDING");
  });

  it("notes provider-absent without accepting or submitting", async () => {
    const saleId = crypto.randomUUID();
    await rpc(fx.userAId, `SELECT public.shop_set_efris_enabled($1::uuid, true) AS result`, [fx.shopAId]);
    await rpc(fx.cashierAId, `SELECT public.shop_enqueue_efris_submission($1::uuid, $2::uuid) AS result`, [
      fx.shopAId,
      saleId,
    ]);
    const noted = await rpc(
      fx.userAId,
      `SELECT public.shop_efris_note_provider_absent($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(noted.ok).toBe(true);
    expect(noted.code).toBe("EFRIS_PROVIDER_NOT_CONFIGURED");
    expect(noted.efris_state).toBe("PENDING");
    expect(noted.efris_state).not.toBe("ACCEPTED");
    expect(noted.efris_state).not.toBe("SUBMITTED");

    const cross = await rpc(
      fx.userBId,
      `SELECT public.shop_efris_note_provider_absent($1::uuid, $2::uuid) AS result`,
      [fx.shopAId, saleId],
    );
    expect(cross.error).toBe("forbidden");
  });

  it("Shop A and Shop B can have independent enabled flags in the same org", async () => {
    await rpc(fx.userAId, `SELECT public.shop_set_efris_enabled($1::uuid, true) AS result`, [fx.shopAId]);
    await rpc(fx.userBId, `SELECT public.shop_set_efris_enabled($1::uuid, false) AS result`, [fx.shopBId]);
    const a = await rpc(fx.userAId, `SELECT public.shop_get_efris_config($1::uuid) AS result`, [fx.shopAId]);
    const b = await rpc(fx.userBId, `SELECT public.shop_get_efris_config($1::uuid) AS result`, [fx.shopBId]);
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(false);
  });
});
