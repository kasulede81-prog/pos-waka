import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * The migration that publishes the subscription tables to Realtime.
 *
 * Deliberately self-contained rather than riding the subscription payment chain: the
 * property under test is the GUARD, not any function body. It must add each table once,
 * survive being replayed, and — the one that matters most — apply cleanly against a
 * database that has no `supabase_realtime` publication at all, which is every plain
 * Postgres and the PGlite harnesses themselves.
 *
 * The last test is the one a security reviewer looks for: publishing a table must not
 * grant anything. If a future edit folds an RLS or GRANT change in here, it fails.
 */

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261015120000_subscriptions_realtime_publication.sql"),
  "utf8",
);

/** Minimal stand-ins for the two tables, plus a policy, so "grants nothing" is non-trivial. */
const SCHEMA = `
create role authenticated;
create role anon;
create table public.organizations (id uuid primary key default gen_random_uuid());
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb
);
create table public.promotional_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  revoked_at timestamptz
);
alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (true);
`;

async function freshDb(withPublication: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  if (withPublication) await db.exec(`create publication supabase_realtime`);
  return db;
}

async function publishedTables(db: PGlite): Promise<string[]> {
  const res = await db.query<{ tablename: string }>(
    `select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
      order by tablename`,
  );
  return res.rows.map((r) => r.tablename);
}

async function policySnapshot(db: PGlite): Promise<string[]> {
  const res = await db.query<{ row: string }>(
    `select (policyname || '|' || cmd || '|' || coalesce(qual, '')) as row
       from pg_policies where schemaname = 'public' and tablename = 'subscriptions'
      order by policyname`,
  );
  return res.rows.map((r) => r.row);
}

describe("subscriptions realtime publication — guarded and idempotent", () => {
  it("adds both tables to an existing publication", async () => {
    const db = await freshDb(true);
    try {
      expect(await publishedTables(db)).toEqual([]);

      await db.exec(MIGRATION);

      expect(await publishedTables(db)).toEqual(["promotional_grants", "subscriptions"]);
    } finally {
      await db.close();
    }
  });

  it("is replayable — a second run adds nothing and does not error", async () => {
    const db = await freshDb(true);
    try {
      await db.exec(MIGRATION);
      await db.exec(MIGRATION);
      await db.exec(MIGRATION);

      expect(await publishedTables(db)).toEqual(["promotional_grants", "subscriptions"]);
    } finally {
      await db.close();
    }
  });

  it("applies cleanly where there is no realtime publication at all", async () => {
    // A plain Postgres, and the PGlite harnesses. The guard is `pg_publication`, not a
    // bare `alter publication`, precisely so these do not fail.
    const db = await freshDb(false);
    try {
      // The assertion IS that this does not reject.
      await expect(db.exec(MIGRATION)).resolves.toBeDefined();
      // And it did nothing, rather than half-doing something.
      expect(await publishedTables(db)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("leaves REPLICA IDENTITY alone", async () => {
    const db = await freshDb(true);
    try {
      await db.exec(MIGRATION);

      const res = await db.query<{ relreplident: string }>(
        `select relreplident from pg_class where relname = 'subscriptions'`,
      );
      // 'd' = DEFAULT. Only the NEW row is needed to authorise an UPDATE for a client
      // that discards the payload, and subscription rows are never deleted.
      expect(res.rows[0]?.relreplident).toBe("d");
    } finally {
      await db.close();
    }
  });

  it("grants nothing and changes no policy", async () => {
    const db = await freshDb(true);
    try {
      const policiesBefore = await policySnapshot(db);
      const grantsBefore = await db.query<{ row: string }>(
        `select (grantee || '|' || privilege_type) as row
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'subscriptions'
          order by grantee, privilege_type`,
      );

      await db.exec(MIGRATION);

      expect(await policySnapshot(db)).toEqual(policiesBefore);
      const grantsAfter = await db.query<{ row: string }>(
        `select (grantee || '|' || privilege_type) as row
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'subscriptions'
          order by grantee, privilege_type`,
      );
      expect(grantsAfter.rows.map((r) => r.row)).toEqual(grantsBefore.rows.map((r) => r.row));
    } finally {
      await db.close();
    }
  });
});
