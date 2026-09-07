import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import {
  asUser,
  rpcJson,
  type SqlExec,
} from "../test/sqlIntegration/transferEnginePgHarness";

const BOOTSTRAP = join(process.cwd(), "src", "test", "sqlIntegration", "transferEngineBootstrap.sql");
const CASHIER_FN = join(process.cwd(), "src", "test", "sqlIntegration", "r3StockBootstrap.sql");
const MIGRATION_177 = join(process.cwd(), "supabase/migrations/177_shop_policy_sync.sql");
const MIGRATION_178 = join(process.cwd(), "supabase/migrations/178_shop_policy_register_mode.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function createShopPolicySqlHarness(): Promise<SqlExec & { isRealPostgres: boolean }> {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (url) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const exec: SqlExec & { isRealPostgres: boolean } = {
      isRealPostgres: true,
      async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const res = await client.query(sql, params);
        return { rows: res.rows as unknown as T[] };
      },
      async exec(sql: string) {
        await client.query(sql);
      },
      async close() {
        await client.end();
      },
    };
    await exec.exec(readSql(BOOTSTRAP));
    await exec.exec(readSql(CASHIER_FN));
    await exec.exec(readSql(MIGRATION_177));
    await exec.exec(readSql(MIGRATION_178));
    return exec;
  }

  const db = new PGlite();
  const exec: SqlExec & { isRealPostgres: boolean } = {
    isRealPostgres: false,
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params);
      return { rows: res.rows as unknown as T[] };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
  await exec.exec(readSql(BOOTSTRAP));
  await exec.exec(readSql(CASHIER_FN));
  await exec.exec(readSql(MIGRATION_177));
  await exec.exec(readSql(MIGRATION_178));
  return exec;
}

async function pushPolicy(exec: SqlExec, shopId: string, payload: Record<string, unknown>) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.shop_push_shop_policy($1::uuid, $2::jsonb) AS result`,
    [shopId, JSON.stringify(payload)],
  );
  return rpcJson(rows[0]);
}

async function pullPolicy(exec: SqlExec, shopId: string, since: string | null = null) {
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT public.shop_pull_shop_policy($1::uuid, $2::timestamptz) AS result`,
    [shopId, since],
  );
  return rpcJson(rows[0]);
}

describe("BACKOFFICE-02 shop policy SQL / RLS", () => {
  let exec: SqlExec & { isRealPostgres: boolean };
  let orgId = "";
  let shopAId = "";
  let shopBId = "";
  let ownerAId = "";
  let ownerBId = "";
  let cashierAId = "";

  beforeAll(async () => {
    exec = await createShopPolicySqlHarness();
    shopAId = crypto.randomUUID();
    shopBId = crypto.randomUUID();
    ownerAId = crypto.randomUUID();
    ownerBId = crypto.randomUUID();
    cashierAId = crypto.randomUUID();
    orgId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ownerAId}', 'ownera@test.local'),
        ('${ownerBId}', 'ownerb@test.local'),
        ('${cashierAId}', 'cashiera@test.local');
      INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'Policy Org');
      INSERT INTO public.shops (id, organization_id, name) VALUES
        ('${shopAId}', '${orgId}', 'Shop A'),
        ('${shopBId}', '${orgId}', 'Shop B');
      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES
        ('${shopAId}', '${ownerAId}', 'owner'),
        ('${shopBId}', '${ownerBId}', 'owner'),
        ('${shopAId}', '${cashierAId}', 'cashier');
    `);
  }, 120_000);

  afterAll(async () => {
    await exec?.close();
  });

  it("missing row pull is empty, not an error", async () => {
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopAId));
    expect(pulled.ok).toBe(true);
    expect(pulled.empty).toBe(true);
  });

  it("owner can push false/0 values and cashier can pull them", async () => {
    const pushed = await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopAId, {
        discount_control_mode: "max_percent",
        discount_control_mode_updated_at: "2026-09-06T12:00:00.000Z",
        discount_max_percent_threshold: 0,
        discount_max_percent_threshold_updated_at: "2026-09-06T12:00:00.000Z",
        kiosk_quick_sell: false,
        kiosk_quick_sell_updated_at: "2026-09-06T12:00:00.000Z",
        staff_can_record_cash_expenses: false,
        staff_can_record_cash_expenses_updated_at: "2026-09-06T12:00:00.000Z",
        require_cashier_expense_approval: false,
        require_cashier_expense_approval_updated_at: "2026-09-06T12:00:00.000Z",
      }),
    );
    expect(pushed.ok).toBe(true);
    const pulled = await asUser(exec, cashierAId, () => pullPolicy(exec, shopAId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.ok).toBe(true);
    expect(pulled.empty).not.toBe(true);
    expect(pulled.kiosk_quick_sell).toBe(false);
    expect(Number(pulled.discount_max_percent_threshold)).toBe(0);
    expect(pulled.discount_control_mode).toBe("max_percent");
    expect(String(pulled.shop_id)).toBe(shopAId);
  });

  it("H — Shop B owner cannot pull or push Shop A policy", async () => {
    const pulled = await asUser(exec, ownerBId, () => pullPolicy(exec, shopAId));
    expect(pulled.ok).toBe(false);
    expect(pulled.error).toBe("forbidden");
    const pushed = await asUser(exec, ownerBId, () =>
      pushPolicy(exec, shopAId, {
        discount_control_mode: "unrestricted",
        discount_control_mode_updated_at: "2026-09-07T00:00:00.000Z",
      }),
    );
    expect(pushed.ok).toBe(false);
    expect(pushed.error).toBe("forbidden");
  });

  it("J — older timestamp cannot overwrite a newer field", async () => {
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopAId, {
        discount_control_mode: "manager_approval",
        discount_control_mode_updated_at: "2026-09-08T12:00:00.000Z",
      }),
    );
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopAId, {
        discount_control_mode: "unrestricted",
        discount_control_mode_updated_at: "2026-09-07T12:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopAId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.discount_control_mode).toBe("manager_approval");
  });

  it("cashier cannot push shop policy", async () => {
    const pushed = await asUser(exec, cashierAId, () =>
      pushPolicy(exec, shopAId, {
        discount_control_mode: "unrestricted",
        discount_control_mode_updated_at: "2026-09-09T12:00:00.000Z",
      }),
    );
    expect(pushed.ok).toBe(false);
    expect(pushed.error).toBe("forbidden");
  });

  async function createOwnedShop(name: string): Promise<string> {
    const shopId = crypto.randomUUID();
    await exec.exec(`
      INSERT INTO public.shops (id, organization_id, name) VALUES ('${shopId}', '${orgId}', '${name}');
      INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ('${shopId}', '${ownerAId}', 'owner');
    `);
    return shopId;
  }

  it("P2 — omitted kiosk on first insert seeds false, not true", async () => {
    const shopId = await createOwnedShop("P2 seed");
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        discount_control_mode: "max_percent",
        discount_control_mode_updated_at: "2026-09-06T12:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.ok).toBe(true);
    expect(pulled.kiosk_quick_sell).toBe(false);
    expect(pulled.discount_control_mode).toBe("max_percent");
    expect(pulled.staff_can_record_cash_expenses).toBe(false);
    expect(pulled.require_cashier_expense_approval).toBe(false);
  });

  it("P2 — unstamped kiosk false at epoch stays false on first policy save", async () => {
    const shopId = await createOwnedShop("P2 pharmacy");
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        discount_control_mode: "manager_approval",
        discount_control_mode_updated_at: "2026-09-06T12:00:00.000Z",
        kiosk_quick_sell: false,
        kiosk_quick_sell_updated_at: "1970-01-01T00:00:00.000Z",
        staff_can_record_cash_expenses: false,
        staff_can_record_cash_expenses_updated_at: "1970-01-01T00:00:00.000Z",
        require_cashier_expense_approval: false,
        require_cashier_expense_approval_updated_at: "1970-01-01T00:00:00.000Z",
        discount_max_percent_threshold: 10,
        discount_max_percent_threshold_updated_at: "1970-01-01T00:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.kiosk_quick_sell).toBe(false);
    expect(pulled.discount_control_mode).toBe("manager_approval");
    expect(Number(pulled.discount_max_percent_threshold)).toBe(10);
    expect(pulled.staff_can_record_cash_expenses).toBe(false);
    expect(pulled.require_cashier_expense_approval).toBe(false);
  });

  it("P2 — unstamped kiosk true at epoch still wins the false seed", async () => {
    const shopId = await createOwnedShop("P2 kiosk");
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        discount_control_mode: "unrestricted",
        discount_control_mode_updated_at: "2026-09-06T12:00:00.000Z",
        kiosk_quick_sell: true,
        kiosk_quick_sell_updated_at: "1970-01-01T00:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.kiosk_quick_sell).toBe(true);
    expect(pulled.discount_control_mode).toBe("unrestricted");
  });

  it("P2 — unstamped local false at epoch cannot overwrite explicit true", async () => {
    const shopId = await createOwnedShop("P2 explicit");
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        kiosk_quick_sell: true,
        kiosk_quick_sell_updated_at: "2026-09-06T10:00:00.000Z",
      }),
    );
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        kiosk_quick_sell: false,
        kiosk_quick_sell_updated_at: "1970-01-01T00:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.kiosk_quick_sell).toBe(true);
  });

  it("P2 — newer explicit false overwrites true", async () => {
    const shopId = await createOwnedShop("P2 flip off");
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        kiosk_quick_sell: true,
        kiosk_quick_sell_updated_at: "2026-09-06T10:00:00.000Z",
      }),
    );
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopId, {
        kiosk_quick_sell: false,
        kiosk_quick_sell_updated_at: "2026-09-06T11:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.kiosk_quick_sell).toBe(false);
  });

  it("BACKOFFICE-04 — owner can push register mode and cashier can pull it", async () => {
    const pushed = await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopAId, {
        register_mode: "single",
        register_mode_updated_at: "2026-09-07T12:00:00.000Z",
        primary_device_fingerprint: "device-A-fingerprint",
        primary_device_fingerprint_updated_at: "2026-09-07T12:00:00.000Z",
      }),
    );
    expect(pushed.ok).toBe(true);
    const pulled = await asUser(exec, cashierAId, () => pullPolicy(exec, shopAId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.ok).toBe(true);
    expect(pulled.register_mode).toBe("single");
    expect(pulled.primary_device_fingerprint).toBe("device-A-fingerprint");
    expect(String(pulled.shop_id)).toBe(shopAId);
  });

  it("BACKOFFICE-04 — stale fingerprint cannot overwrite a newer primary", async () => {
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopAId, {
        primary_device_fingerprint: "device-A-fingerprint",
        primary_device_fingerprint_updated_at: "2026-09-08T12:00:00.000Z",
      }),
    );
    await asUser(exec, ownerAId, () =>
      pushPolicy(exec, shopAId, {
        primary_device_fingerprint: "device-B-fingerprint",
        primary_device_fingerprint_updated_at: "2026-09-07T12:00:00.000Z",
      }),
    );
    const pulled = await asUser(exec, ownerAId, () => pullPolicy(exec, shopAId, "1970-01-01T00:00:00.000Z"));
    expect(pulled.primary_device_fingerprint).toBe("device-A-fingerprint");
  });

  it("BACKOFFICE-04 — Shop B owner cannot write Shop A register mode", async () => {
    const pushed = await asUser(exec, ownerBId, () =>
      pushPolicy(exec, shopAId, {
        register_mode: "multi",
        register_mode_updated_at: "2026-09-10T00:00:00.000Z",
      }),
    );
    expect(pushed.ok).toBe(false);
    expect(pushed.error).toBe("forbidden");
  });
});
