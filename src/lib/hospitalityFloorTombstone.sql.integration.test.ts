import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * Migration 20260919090000 — server-side tombstone protection for the floor layout.
 * Runs the ORIGINAL function (migration 128) to prove the defects, then the whole new migration.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const SHOP = "11111111-1111-4111-8111-111111111111";
const AREA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb";
const T1_NEW = "cccccccc-1111-4ccc-8ccc-cccccccccccc";
const STATION = "dddddddd-1111-4ddd-8ddd-dddddddddddd";
const AREA2 = "eeeeeeee-2222-4eee-8eee-eeeeeeeeeeee";

function extractOriginalFunction(): string {
  const src = readFileSync(join(dir, "128_hospitality_front_of_house.sql"), "utf8");
  const start = src.indexOf("create or replace function public.shop_push_hospitality_floor");
  return src.slice(start, src.indexOf("$$;", start) + 3);
}
const newMigration = () => readFileSync(join(dir, "20260919090000_hospitality_floor_tombstone_guard.sql"), "utf8");

async function freshDb(functionSql: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create function auth.uid () returns uuid language sql as $$ select '99999999-9999-4999-8999-999999999999'::uuid $$;
    create function public.user_is_cashier_or_above (p uuid) returns boolean language sql as $$ select true $$;
    create table public.dining_areas (
      id uuid primary key, shop_id uuid not null, name text not null, sort_order int not null default 0,
      is_active boolean not null default true, metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create unique index dining_areas_shop_name_unique on public.dining_areas (shop_id, lower(trim (name)));
    create table public.dining_tables (
      id uuid primary key, shop_id uuid not null, area_id uuid not null references public.dining_areas (id) on delete cascade,
      label text not null, capacity int, sort_order int not null default 0, display_status text not null default 'available',
      is_active boolean not null default true, grid_x int, grid_y int, metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create unique index dining_tables_shop_area_label_unique on public.dining_tables (shop_id, area_id, lower(trim (label)));
    create table public.kitchen_stations (
      id uuid primary key, shop_id uuid not null, name text not null, station_type text not null, sort_order int not null default 0,
      is_active boolean not null default true, print_config jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create unique index kitchen_stations_shop_name_unique on public.kitchen_stations (shop_id, lower(trim (name)));
    create table public.table_reservations (
      id uuid primary key, shop_id uuid not null, reservation_number int, guest_name text, phone text, email text,
      guest_count int, reservation_date date, reservation_time time, area_id uuid, preferred_table_id uuid, notes text,
      is_vip boolean, status text, metadata jsonb, created_at timestamptz, updated_at timestamptz
    );
    create table public.waitlist_entries (
      id uuid primary key, shop_id uuid not null, name text, guest_count int, phone text, arrival_time timestamptz,
      estimated_wait_minutes int, priority text, notes text, source text, status text, metadata jsonb,
      created_at timestamptz, updated_at timestamptz
    );
  `);
  await db.exec(functionSql);
  return db;
}

type Row = Record<string, unknown>;
const area = (over: Row = {}): Row => ({ id: AREA, name: "Main Hall", sort_order: 0, is_active: true, metadata: {}, updated_at: "2026-09-18T10:00:00Z", ...over });
const table = (over: Row = {}): Row => ({
  id: T1, area_id: AREA, label: "Table 1", capacity: 4, sort_order: 0, is_active: true, metadata: {}, updated_at: "2026-09-18T10:00:00Z", ...over,
});
const station = (over: Row = {}): Row => ({
  id: STATION, name: "Kitchen", station_type: "kitchen", sort_order: 0, is_active: true, print_config: {}, updated_at: "2026-09-18T10:00:00Z", ...over,
});
const tombstoneAt = "2026-09-18T12:00:00Z";
const deleted = (metaKey: "metadata" | "print_config" = "metadata"): Row => ({
  is_active: false,
  [metaKey]: { deletedAt: tombstoneAt },
  updated_at: tombstoneAt,
});

async function push(db: PGlite, p: { areas?: Row[]; tables?: Row[]; stations?: Row[]; reservations?: Row[]; waitlist?: Row[] }) {
  const res = await db.query<{ r: { ok: boolean; error?: string } }>(
    "select public.shop_push_hospitality_floor($1::uuid, $2::jsonb) as r",
    [SHOP, JSON.stringify(p)],
  );
  return res.rows[0]!.r;
}
const q = async <T extends Row>(db: PGlite, sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows;

async function seedLive(db: PGlite) {
  expect((await push(db, { areas: [area()], tables: [table()], stations: [station()] })).ok).toBe(true);
}

describe("original function (128) — documents the defects", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(extractOriginalFunction());
  }, 60_000);
  afterAll(async () => db.close());

  it("a stale device's older ACTIVE copy revives a deleted table, area and station", async () => {
    await seedLive(db);
    await push(db, { areas: [area({ ...deleted() })], tables: [table({ ...deleted() })], stations: [station({ ...deleted("print_config") })] });
    expect((await q<{ is_active: boolean }>(db, "select is_active from public.dining_tables where id = $1", [T1]))[0]!.is_active).toBe(false);

    await push(db, { areas: [area()], tables: [table()], stations: [station()] }); // stale copy, older updated_at
    expect((await q<{ is_active: boolean }>(db, "select is_active from public.dining_tables where id = $1", [T1]))[0]!.is_active).toBe(true);
    expect((await q<{ is_active: boolean }>(db, "select is_active from public.dining_areas where id = $1", [AREA]))[0]!.is_active).toBe(true);
    expect((await q<{ is_active: boolean }>(db, "select is_active from public.kitchen_stations where id = $1", [STATION]))[0]!.is_active).toBe(true);
  });

  it("a deleted label blocks re-creating it, and the unique violation rolls back the whole push", async () => {
    const db2 = await freshDb(extractOriginalFunction());
    await seedLive(db2);
    await push(db2, { tables: [table({ ...deleted() })] });
    const res = await push(db2, { tables: [table({ id: T1_NEW }), table({ id: "ffffffff-3333-4fff-8fff-ffffffffffff", label: "Table 9" })] });
    expect(res.ok).toBe(false);
    expect(await q(db2, "select 1 from public.dining_tables where label = 'Table 9'")).toHaveLength(0);
    await db2.close();
  });
});

describe("migration 20260919090000 — tombstones are terminal on the server", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(newMigration());
  }, 60_000);
  afterAll(async () => db.close());

  it("a stale ACTIVE copy can no longer revive a deleted table, area or station", async () => {
    await seedLive(db);
    expect((await push(db, { areas: [area(deleted())], tables: [table(deleted())], stations: [station(deleted("print_config"))] })).ok).toBe(true);

    expect((await push(db, { areas: [area()], tables: [table({ label: "Renamed", capacity: 9 })], stations: [station({ name: "Kitchen 2" })] })).ok).toBe(true);
    const t = (await q<{ is_active: boolean; metadata: { deletedAt?: string }; label: string; capacity: number }>(db, "select * from public.dining_tables where id = $1", [T1]))[0]!;
    expect(t.is_active).toBe(false);
    expect(t.metadata.deletedAt).toBe(tombstoneAt);
    expect(t.capacity).toBe(4); // the stale edit changed nothing
    expect(t.label).toBe("Table 1 [deleted bbbbbbbb]");
    const a = (await q<{ is_active: boolean; metadata: { deletedAt?: string } }>(db, "select * from public.dining_areas where id = $1", [AREA]))[0]!;
    expect([a.is_active, a.metadata.deletedAt]).toEqual([false, tombstoneAt]);
    const s = (await q<{ is_active: boolean; print_config: { deletedAt?: string }; name: string }>(db, "select * from public.kitchen_stations where id = $1", [STATION]))[0]!;
    expect([s.is_active, s.print_config.deletedAt]).toEqual([false, tombstoneAt]);
    expect(s.name).toBe("Kitchen [deleted dddddddd]");
  });

  it("re-sending the tombstone is idempotent", async () => {
    const before = await q(db, "select * from public.dining_tables where id = $1", [T1]);
    expect((await push(db, { tables: [table(deleted())] })).ok).toBe(true);
    expect(await q(db, "select * from public.dining_tables where id = $1", [T1])).toEqual(before);
  });

  it("a deleted label no longer blocks a new table with the same label", async () => {
    const res = await push(db, { tables: [table({ id: T1_NEW }), table({ id: "ffffffff-3333-4fff-8fff-ffffffffffff", label: "Table 9" })] });
    expect(res.ok).toBe(true);
    const live = await q<{ label: string }>(db, "select label from public.dining_tables where is_active order by label");
    expect(live.map((r) => r.label)).toEqual(["Table 1", "Table 9"]);
  });

  it("a tombstone for a row the server never saw is stored (renamed, inactive)", async () => {
    const id = "99999999-4444-4999-8999-999999999999";
    expect((await push(db, { tables: [table({ id, label: "Ghost", ...deleted() })] })).ok).toBe(true);
    const r = (await q<{ label: string; is_active: boolean }>(db, "select label, is_active from public.dining_tables where id = $1", [id]))[0]!;
    expect([r.label, r.is_active]).toEqual(["Ghost [deleted 99999999]", false]);
  });

  it("live rows still update normally", async () => {
    expect((await push(db, { tables: [table({ id: T1_NEW, label: "Table 1", capacity: 6, updated_at: "2026-09-18T13:00:00Z" })] })).ok).toBe(true);
    expect((await q<{ capacity: number }>(db, "select capacity from public.dining_tables where id = $1", [T1_NEW]))[0]!.capacity).toBe(6);
    // and a live row can still be deleted
    expect((await push(db, { tables: [table({ id: T1_NEW, ...deleted() })] })).ok).toBe(true);
    expect((await q<{ is_active: boolean }>(db, "select is_active from public.dining_tables where id = $1", [T1_NEW]))[0]!.is_active).toBe(false);
  });

  it("a second area/table pair is unaffected by another shop's tombstones (scoped by id)", async () => {
    expect((await push(db, { areas: [area({ id: AREA2, name: "Terrace" })] })).ok).toBe(true);
    expect((await q<{ is_active: boolean }>(db, "select is_active from public.dining_areas where id = $1", [AREA2]))[0]!.is_active).toBe(true);
  });
});

describe("migration backfill for tombstones written before it existed", () => {
  it("frees the label of an old tombstone so the same label can be created again, and is idempotent", async () => {
    const db = await freshDb(extractOriginalFunction());
    await seedLive(db);
    await push(db, { tables: [table(deleted())] }); // old server: tombstone keeps its label
    expect((await push(db, { tables: [table({ id: T1_NEW })] })).ok).toBe(false);

    await db.exec(newMigration()); // installs the guard and runs the backfill
    expect((await q<{ label: string }>(db, "select label from public.dining_tables where id = $1", [T1]))[0]!.label).toBe("Table 1 [deleted bbbbbbbb]");
    expect((await push(db, { tables: [table({ id: T1_NEW })] })).ok).toBe(true);

    await db.exec(newMigration()); // re-running changes nothing
    expect((await q<{ label: string }>(db, "select label from public.dining_tables where id = $1", [T1]))[0]!.label).toBe("Table 1 [deleted bbbbbbbb]");
    await db.close();
  }, 60_000);
});

// ── reservations / waitlist only move forward ─────────────────────────────────

const RES = "77777777-7777-4777-8777-777777777777";
const WL = "88888888-8888-4888-8888-888888888888";
const reservationRow = (status: string, updated_at: string, over: Row = {}): Row => ({
  id: RES, reservation_number: 1, guest_name: "Guest", phone: "0700", guest_count: 2, reservation_date: "2026-09-19",
  reservation_time: "19:00", status, updated_at, ...over,
});
const waitlistRow = (status: string, updated_at: string, over: Row = {}): Row => ({
  id: WL, name: "Walk-in", guest_count: 2, status, updated_at, ...over,
});
const resStatus = async (db: PGlite) => (await q<{ status: string; guest_count: number }>(db, "select status, guest_count from public.table_reservations where id = $1", [RES]))[0]!;
const wlStatus = async (db: PGlite) => (await q<{ status: string }>(db, "select status from public.waitlist_entries where id = $1", [WL]))[0]!.status;

describe("original function (128) — reservations/waitlist are timestamp-only", () => {
  it("a newer-stamped stale 'confirmed' un-cancels a reservation and 'waiting' un-seats a party", async () => {
    const db = await freshDb(extractOriginalFunction());
    await push(db, { reservations: [reservationRow("cancelled", "2026-09-19T09:00:00Z")], waitlist: [waitlistRow("seated", "2026-09-19T09:00:00Z")] });
    await push(db, { reservations: [reservationRow("confirmed", "2026-09-19T12:00:00Z")], waitlist: [waitlistRow("waiting", "2026-09-19T12:00:00Z")] });
    expect((await resStatus(db)).status).toBe("confirmed");
    expect(await wlStatus(db)).toBe("waiting");
    await db.close();
  });
});

describe("migration 20260919090000 — reservations/waitlist only move forward", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(newMigration());
  }, 60_000);
  afterAll(async () => db.close());

  it("a newer-stamped stale 'confirmed' cannot un-cancel; a newer 'waiting' cannot un-seat", async () => {
    await push(db, { reservations: [reservationRow("cancelled", "2026-09-19T09:00:00Z")], waitlist: [waitlistRow("seated", "2026-09-19T09:00:00Z")] });
    expect((await push(db, { reservations: [reservationRow("confirmed", "2026-09-19T12:00:00Z")], waitlist: [waitlistRow("waiting", "2026-09-19T12:00:00Z")] })).ok).toBe(true);
    expect((await resStatus(db)).status).toBe("cancelled");
    expect(await wlStatus(db)).toBe("seated");
  });

  it("moving forward is accepted even with an older timestamp (seated beats cancelled)", async () => {
    await push(db, { reservations: [reservationRow("seated", "2026-09-19T08:00:00Z")] });
    expect((await resStatus(db)).status).toBe("seated");
    await push(db, { reservations: [reservationRow("completed", "2026-09-19T07:00:00Z")] });
    expect((await resStatus(db)).status).toBe("completed");
  });

  it("the same status keeps last-write-wins by updated_at", async () => {
    const id = "99999999-7777-4999-8999-999999999999";
    await push(db, { reservations: [reservationRow("confirmed", "2026-09-19T09:00:00Z", { id, guest_count: 2 })] });
    await push(db, { reservations: [reservationRow("confirmed", "2026-09-19T11:00:00Z", { id, guest_count: 6 })] });
    await push(db, { reservations: [reservationRow("confirmed", "2026-09-19T10:00:00Z", { id, guest_count: 3 })] }); // older -> ignored
    const r = (await q<{ guest_count: number }>(db, "select guest_count from public.table_reservations where id = $1", [id]))[0]!;
    expect(r.guest_count).toBe(6);
  });

  it("a brand-new row is inserted in whatever status it arrives", async () => {
    const id = "99999999-6666-4999-8999-999999999999";
    await push(db, { waitlist: [waitlistRow("cancelled", "2026-09-19T09:00:00Z", { id })] });
    expect((await q<{ status: string }>(db, "select status from public.waitlist_entries where id = $1", [id]))[0]!.status).toBe("cancelled");
  });
});
