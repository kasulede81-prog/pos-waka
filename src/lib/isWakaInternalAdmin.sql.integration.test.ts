/**
 * `public.is_waka_internal_admin()` — the missing gate, and the migration that
 * defines it.
 *
 * PRODUCTION FINDING (project ljaedextsenbkxzzgxcg), proven two ways:
 *   * `gen types --linked` exposes `is_waka_internal_staff` and
 *     `is_waka_internal_role` but not `is_waka_internal_admin`;
 *   * `db lint --linked` compiles the DEPLOYED body and reports
 *     "function public.is_waka_internal_admin() does not exist".
 *
 * Every call to `admin_update_platform_subscription_settings` therefore raises
 * 42883 at its gate, so the admin Subscription Policy page cannot save.
 *
 * This suite runs the real SQL through PGlite: it first reproduces the
 * production failure, then applies the migration and exercises the gate as each
 * role. A test that only read the migration text would not catch a wrong role
 * list or a signature that does not match the caller.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/** The RPC body EXACTLY as migration 135 deploys it — gate first. */
const RPC_AS_DEPLOYED = `
create or replace function public.admin_update_platform_subscription_settings (p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_waka_internal_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  insert into public.platform_settings (key, value, updated_at, updated_by)
  values ('subscription_settings', p_settings, now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_update_platform_subscription_settings (jsonb) from public;
grant execute on function public.admin_update_platform_subscription_settings (jsonb) to authenticated;
`;

const SUPER = "11111111-1111-4111-8111-111111111111";
const OPERATIONS = "22222222-2222-4222-8222-222222222222";
const FINANCE = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";

describe("is_waka_internal_admin — reproduced in production, fixed by migration", () => {
  let db: PGlite;

  /** Run a query as a signed-in user, the way the harness's `asUser` does. */
  async function asRole<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec("BEGIN");
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await db.exec("SET LOCAL ROLE authenticated");
    try {
      const out = await fn();
      await db.exec("COMMIT");
      return out;
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }
  }

  const callRpc = async (): Promise<Record<string, unknown>> => {
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.admin_update_platform_subscription_settings('{"monthlyDurationDays":45}'::jsonb) as r`,
    );
    return rows[0]!.r;
  };

  let migrationSql: string;

  beforeAll(async () => {
    db = new PGlite();
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    migrationSql = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../supabase/migrations/20261009120000_define_is_waka_internal_admin.sql",
      ),
      "utf8",
    );

    // --- the minimal production-shaped prerequisites ---
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      end $$;

      create table public.internal_admins (
        user_id uuid, auth_user_id uuid, role text, active boolean default true, is_active boolean default true
      );

      /* the sibling that DOES exist in production, verbatim in shape */
      create or replace function public.is_waka_internal_role (p_roles text[])
      returns boolean language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from public.internal_admins ia
          where coalesce(ia.auth_user_id, ia.user_id) = auth.uid()
            and coalesce(ia.is_active, ia.active, true) = true
            and ia.role = any (p_roles)
        )
      $$;

      create table public.platform_settings (
        key text primary key, value jsonb, updated_at timestamptz, updated_by uuid
      );

      insert into public.internal_admins (user_id, role) values
        ('${SUPER}', 'super_admin'),
        ('${OPERATIONS}', 'operations_admin'),
        ('${FINANCE}', 'finance_admin');
    `);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("REPRODUCES PRODUCTION: the deployed RPC fails without the missing function", async () => {
    await db.exec(RPC_AS_DEPLOYED);

    // The exact production error.
    await expect(asRole(OPERATIONS, callRpc)).rejects.toThrow(/is_waka_internal_admin\(\) does not exist/);
  });

  it("the migration defines it, and the RPC then works for operations_admin", async () => {
    await db.exec(migrationSql);

    const result = await asRole(OPERATIONS, callRpc);
    expect(result).toEqual({ ok: true });
  });

  it("super_admin is allowed too (matches the page's client gate)", async () => {
    await db.exec("delete from public.platform_settings");
    expect(await asRole(SUPER, callRpc)).toEqual({ ok: true });
  });

  it("finance_admin is REFUSED — not any internal staffer may rewrite platform policy", async () => {
    const result = await asRole(FINANCE, callRpc);
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("a user who is not an internal admin at all is refused", async () => {
    const result = await asRole(OUTSIDER, callRpc);
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("the write actually landed, with the caller recorded", async () => {
    const { rows } = await db.query<{ value: { monthlyDurationDays: number }; updated_by: string }>(
      `select value, updated_by::text from public.platform_settings where key = 'subscription_settings'`,
    );
    expect(rows[0]!.value.monthlyDurationDays).toBe(45);
    expect(rows[0]!.updated_by).toBe(SUPER);
  });

  it("is defined the way the sibling helpers are: sql, stable, security definer", async () => {
    const { rows } = await db.query<{ lang: string; volatility: string; secdef: boolean; cfg: string[] | null }>(
      `select l.lanname as lang, p.provolatile as volatility, p.prosecdef as secdef, p.proconfig as cfg
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
        where n.nspname = 'public' and p.proname = 'is_waka_internal_admin'`,
    );
    expect(rows[0]!.lang).toBe("sql");
    expect(rows[0]!.volatility).toBe("s"); // stable
    expect(rows[0]!.secdef).toBe(true);
    expect(rows[0]!.cfg).toContain("search_path=public");
  });

  it("EXECUTE is granted explicitly, not left to PUBLIC", async () => {
    const { rows } = await db.query<{ acl: string | null }>(
      `select array_to_string(p.proacl, '|') as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'is_waka_internal_admin'`,
    );
    const acl = rows[0]!.acl ?? "";
    // The migration must have set an explicit ACL (so PUBLIC does not keep EXECUTE).
    expect(acl).not.toBe("");
    expect(acl).toContain("authenticated=X");
  });
});
