import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260918160000 — enable the unified `hospitality` business type.
 *
 * The starting state below is the real production state observed before the migration:
 * validator already accepts hospitality, but platform_settings.business_types_enabled and
 * platform_default_business_types_enabled() only list the legacy hospitality types.
 */

const MIGRATION = "20260918160000_hospitality_enabled_business_type.sql";
const PROD_ENABLED = [
  "kiosk_duka",
  "boutique",
  "pharmacy",
  "wholesale",
  "restaurant",
  "mobile_money_agent",
  "other",
  "bar",
  "restaurant_bar",
];

let db: PGlite;
const dir = join(process.cwd(), "supabase", "migrations");

async function enabledList(): Promise<string[]> {
  const res = await db.query<{ value: string[] }>(
    "select value from public.platform_settings where key = 'business_types_enabled'",
  );
  return res.rows[0]?.value ?? [];
}

async function resetStored(list: string[] | null): Promise<void> {
  await db.exec("delete from public.platform_settings where key = 'business_types_enabled'");
  if (list) {
    await db.query("insert into public.platform_settings (key, value) values ('business_types_enabled', $1::jsonb)", [
      JSON.stringify(list),
    ]);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create schema if not exists auth;");
  await db.exec(readFileSync(join(dir, "078_business_type_persistence.sql"), "utf8"));
  await db.exec(readFileSync(join(dir, "20260918143000_hospitality_business_type_validation.sql"), "utf8"));
  await db.exec(`
    create table public.platform_settings (
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  // Legacy default exactly as defined by migration 096 (no 'hospitality').
  await db.exec(`
    create or replace function public.platform_default_business_types_enabled ()
    returns jsonb language sql immutable as $$
      select jsonb_build_array ('kiosk_duka','boutique','pharmacy','wholesale','restaurant','bar','restaurant_bar','hotel','mobile_money_agent','other');
    $$;
  `);
  await resetStored(PROD_ENABLED);
  await db.exec(readFileSync(join(dir, MIGRATION), "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("hospitality enabled business type migration", () => {
  it("appends hospitality to the production-shaped stored list without dropping legacy types", async () => {
    const list = await enabledList();
    expect(list).toContain("hospitality");
    for (const legacy of PROD_ENABLED) expect(list).toContain(legacy);
    expect(list).toHaveLength(PROD_ENABLED.length + 1);
  });

  it("is idempotent", async () => {
    const before = await enabledList();
    await db.exec(readFileSync(join(dir, MIGRATION), "utf8"));
    const after = await enabledList();
    expect(after).toEqual(before);
    expect(after.filter((t) => t === "hospitality")).toHaveLength(1);
  });

  it("does not override an admin who disabled every hospitality-family type", async () => {
    await resetStored(["kiosk_duka", "pharmacy"]);
    await db.exec(readFileSync(join(dir, MIGRATION), "utf8"));
    expect(await enabledList()).toEqual(["kiosk_duka", "pharmacy"]);
  });

  it("leaves a missing setting row alone (client/default fallback applies)", async () => {
    await resetStored(null);
    await db.exec(readFileSync(join(dir, MIGRATION), "utf8"));
    expect(await enabledList()).toEqual([]);
  });

  it("registration default now includes hospitality and every legacy type", async () => {
    const res = await db.query<{ v: string[] }>("select public.platform_default_business_types_enabled() as v");
    const v = res.rows[0]!.v;
    for (const t of ["hospitality", "restaurant", "bar", "restaurant_bar", "hotel", "kiosk_duka", "pharmacy"]) {
      expect(v).toContain(t);
    }
  });

  it("validator accepts hospitality and all legacy hospitality types, rejects junk", async () => {
    for (const t of ["hospitality", "restaurant", "bar", "restaurant_bar", "hotel"]) {
      const res = await db.query<{ ok: boolean }>("select public.is_valid_shop_business_type($1) as ok", [t]);
      expect(res.rows[0]!.ok).toBe(true);
    }
    const bad = await db.query<{ ok: boolean }>("select public.is_valid_shop_business_type('nope') as ok");
    expect(bad.rows[0]!.ok).toBe(false);
  });

  it("bootstrap_owner_workspace validates through the shared validator, not a stale literal list", async () => {
    const res = await db.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'bootstrap_owner_workspace'",
    );
    const src = res.rows[0]!.src;
    expect(src).toContain("is_valid_shop_business_type (v_business_type)");
    expect(src).not.toContain("'restaurant','salon'");
  });
});
