import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * PGlite harness for the shop business-data reset / certified hard delete.
 *
 * The schema is rebuilt from `shopResetTopology.txt`: the REAL production foreign-key graph (tables, FK columns,
 * nullability and ON DELETE actions) captured read-only from pg_constraint. Only the delete-dependency shape is
 * mirrored; business columns are irrelevant to FK ordering. The functions under test are the REAL migration bodies.
 */

export type SqlExec = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

const ROOT = process.cwd();
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const NEW_MIGRATION = join(MIGRATIONS_DIR, "20260920100000_shop_reset_fk_ordered_plan.sql");
export const TOPOLOGY_FILE = join(ROOT, "src", "test", "sqlIntegration", "shopResetTopology.txt");

export type FkEdge = { child: string; parent: string; column: string; action: "c" | "r" | "a" | "n"; notNull: boolean };

export function readTopology(): FkEdge[] {
  return readFileSync(TOPOLOGY_FILE, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((line) => {
      const [child, parent, column, tail] = line.split("|");
      return { child, parent, column, action: tail[0] as FkEdge["action"], notNull: tail[1] === "N" };
    });
}

export function readMigrationText(file: string): string {
  return readFileSync(file, "utf8");
}

/** Extract one `create or replace function public.<name> ... $tag$ ... $tag$;` block from a migration file. */
export function extractFunction(file: string, name: string, argHint?: RegExp): string {
  const text = readMigrationText(file);
  const re = new RegExp(`create or replace function public\\.${name}\\s*\\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const tagMatch = /as\s+(\$[a-zA-Z_]*\$)/i.exec(text.slice(start));
    if (!tagMatch) continue;
    const tag = tagMatch[1];
    const bodyStart = start + tagMatch.index + tagMatch[0].length;
    const bodyEnd = text.indexOf(tag, bodyStart);
    const end = text.indexOf(";", bodyEnd + tag.length) + 1;
    const block = text.slice(start, end);
    if (!argHint || argHint.test(block.slice(0, 400))) return block;
  }
  throw new Error(`function ${name} not found in ${file}`);
}

const EXTRA_COLUMNS: Record<string, string> = {
  organizations: "name text",
  shops: "name text, shop_number text, owner_user_id uuid",
  audit_logs:
    "actor_user_id uuid, role text, action text, payload_summary text, payload jsonb, created_at timestamptz default now()",
  internal_ops_admin_audit: "actor uuid, action text, payload jsonb, created_at timestamptz default now()",
  sync_health:
    "pending_outbound int, last_error text, last_pull_at timestamptz, last_push_ok_at timestamptz, updated_at timestamptz",
  shop_recovery_signals: "force_full_resync_at timestamptz, updated_at timestamptz",
  shop_devices: "status public.shop_device_status not null default 'active', updated_at timestamptz",
  profiles: "email text",
  marketing_agents: "user_id uuid, email text",
  agent_referrals: "referred_user_id uuid",
  shop_members: "user_id uuid, role text",
  organization_members: "user_id uuid",
  internal_admins: "auth_user_id uuid, user_id uuid, role text, is_active boolean, active boolean",
};

function bootstrapSql(edges: FkEdge[]): string {
  const tables = new Set<string>();
  const cols = new Map<string, Map<string, boolean>>();
  for (const e of edges) {
    tables.add(e.child);
    tables.add(e.parent);
    if (!cols.has(e.child)) cols.set(e.child, new Map());
    cols.get(e.child)!.set(e.column, e.notNull);
  }
  for (const t of ["organization_members", "internal_admins", "profiles"]) tables.add(t);

  const lines: string[] = [];
  lines.push(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
    CREATE OR REPLACE FUNCTION auth.uid () RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    CREATE TYPE public.shop_device_status AS ENUM ('active', 'disconnected', 'revoked');
    CREATE TABLE public.waka_shop_number_released (shop_number text PRIMARY KEY);
  `);
  for (const t of [...tables].sort()) {
    const defs = [`id uuid PRIMARY KEY DEFAULT gen_random_uuid()`];
    if (EXTRA_COLUMNS[t]) defs.push(EXTRA_COLUMNS[t]);
    for (const [col, notNull] of cols.get(t) ?? []) defs.push(`${col} uuid${notNull ? " NOT NULL" : ""}`);
    lines.push(`CREATE TABLE public.${t} (${defs.join(", ")});`);
  }
  lines.push(`CREATE UNIQUE INDEX sync_health_shop_uq ON public.sync_health (shop_id);`);
  lines.push(`CREATE UNIQUE INDEX shop_recovery_signals_shop_uq ON public.shop_recovery_signals (shop_id);`);
  const action = { c: "CASCADE", r: "RESTRICT", a: "NO ACTION", n: "SET NULL" } as const;
  for (const e of edges) {
    lines.push(
      `ALTER TABLE public.${e.child} ADD CONSTRAINT ${e.child}_${e.column}_fkey FOREIGN KEY (${e.column}) ` +
        `REFERENCES public.${e.parent} (id) ON DELETE ${action[e.action]};`,
    );
  }
  lines.push(`
    CREATE OR REPLACE FUNCTION public.is_waka_internal_role (p_roles text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.internal_admins ia
        WHERE ia.auth_user_id = auth.uid() AND coalesce(ia.is_active, true) AND ia.role = ANY (p_roles));
    $$;
  `);
  return lines.join("\n");
}

const COLLECT_FNS = join(MIGRATIONS_DIR, "112_certified_hard_delete.sql");

export async function createShopResetHarness(opts: { applyNewMigration?: boolean } = {}): Promise<SqlExec> {
  const db = new PGlite();
  const exec: SqlExec = {
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
  await exec.exec(bootstrapSql(readTopology()));
  // real production helper functions the certified hard delete depends on
  await exec.exec(extractFunction(COLLECT_FNS, "hard_delete_collect_org_user_ids"));
  await exec.exec(extractFunction(COLLECT_FNS, "hard_delete_collect_org_shop_ids"));
  if (opts.applyNewMigration !== false) await exec.exec(readMigrationText(NEW_MIGRATION));
  return exec;
}

/** Run `fn` as an authenticated user (auth.uid() = userId). */
export async function asUser<T>(exec: SqlExec, userId: string, fn: () => Promise<T>): Promise<T> {
  await exec.exec("BEGIN");
  await exec.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  try {
    const out = await fn();
    await exec.exec("COMMIT");
    return out;
  } catch (err) {
    await exec.exec("ROLLBACK");
    throw err;
  }
}

export function json(row: Record<string, unknown> | undefined, key: string): Record<string, unknown> {
  const raw = row?.[key];
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  return {};
}

export type Seeded = { orgId: string; shopId: string; rows: Map<string, string> };

/**
 * Seed ONE row in EVERY table of the topology for one shop, following the FK graph, so every delete-dependency
 * edge (RESTRICT / NO ACTION / SET NULL / CASCADE) has a real referencing row. Self references and the
 * shops<->shop_devices cycle stay NULL (a few are wired explicitly by the tests).
 */
export async function seedEverything(exec: SqlExec, skip: string[] = []): Promise<Seeded> {
  const edges = readTopology();
  const byChild = new Map<string, FkEdge[]>();
  for (const e of edges) byChild.set(e.child, [...(byChild.get(e.child) ?? []), e]);
  const rows = new Map<string, string>();
  const orgId = crypto.randomUUID();
  const shopId = crypto.randomUUID();
  const newId = () => crypto.randomUUID();
  await exec.exec(`INSERT INTO public.organizations (id, name) VALUES ('${orgId}', 'org ${orgId.slice(0, 4)}')`);
  await exec.exec(
    `INSERT INTO public.shops (id, organization_id, name, shop_number) VALUES ('${shopId}', '${orgId}', 'shop', 'A${Math.floor(Math.random() * 9000 + 1000)}')`,
  );
  rows.set("organizations", orgId);
  rows.set("shops", shopId);

  const inStack = new Set<string>();
  const seedTable = async (table: string): Promise<string | null> => {
    if (rows.has(table)) return rows.get(table)!;
    if (skip.includes(table) || inStack.has(table)) return null;
    inStack.add(table);
    const cols: string[] = ["id"];
    const vals: string[] = [];
    const id = newId();
    vals.push(`'${id}'`);
    for (const e of byChild.get(table) ?? []) {
      if (e.parent === table) continue; // self reference: left NULL
      if (e.parent === "shops") {
        cols.push(e.column);
        vals.push(`'${shopId}'`);
        continue;
      }
      if (e.parent === "organizations") {
        cols.push(e.column);
        vals.push(`'${orgId}'`);
        continue;
      }
      if (e.parent === "shop_devices" && e.child === "shops") continue; // cycle
      const parentId = await seedTable(e.parent);
      if (parentId) {
        cols.push(e.column);
        vals.push(`'${parentId}'`);
      } else if (e.notNull) {
        inStack.delete(table);
        return null;
      }
    }
    await exec.exec(`INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${vals.join(", ")})`);
    rows.set(table, id);
    inStack.delete(table);
    return id;
  };
  const tables = [...new Set(edges.map((e) => e.child))].filter((t) => t !== "shops");
  for (const t of tables) await seedTable(t);
  return { orgId, shopId, rows };
}

/** Row counts of every table in the topology that can be attributed to the shop / org (for before/after diffs). */
export async function tableCounts(exec: SqlExec): Promise<Record<string, number>> {
  const edges = readTopology();
  const tables = [...new Set([...edges.map((e) => e.child), ...edges.map((e) => e.parent)])].sort();
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`);
    out[t] = rows[0].n;
  }
  return out;
}
