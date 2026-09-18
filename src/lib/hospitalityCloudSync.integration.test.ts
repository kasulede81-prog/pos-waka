/**
 * Two-device Hospitality sync against an in-memory fake cloud that enforces the same rules as the
 * real database: foreign keys (table_sessions.table_id, kitchen_tickets.station_id), unique
 * area / table / station labels, upsert-only layout pushes, and newer-wins ticket headers.
 * Nothing here touches finance: sync only moves operational rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;
  const db = {
    areas: new Map<string, Row>(),
    tables: new Map<string, Row>(),
    stations: new Map<string, Row>(),
    sessions: new Map<string, Row>(),
    tickets: new Map<string, Row>(),
  };
  const calls: string[] = [];
  const reset = () => {
    for (const m of Object.values(db)) m.clear();
    calls.length = 0;
  };
  const lower = (s: string) => String(s).trim().toLowerCase();
  const err = (message: string) => ({ data: null, error: { message } });

  async function rpc(name: string, args: { p_shop_id: string; p_payload?: Row; p_since?: string }) {
    calls.push(name);
    const p = args.p_payload ?? {};
    const at = new Date().toISOString();

    if (name === "shop_push_hospitality_floor") {
      // atomic like the real plpgsql function: stage, validate, then commit
      const areas = new Map(db.areas);
      const tables = new Map(db.tables);
      const stations = new Map(db.stations);
      for (const a of p.areas ?? []) {
        for (const r of areas.values()) {
          if (r.id !== a.id && lower(r.name) === lower(a.name)) return err("dining_areas_shop_name_unique");
        }
        areas.set(a.id, { id: a.id, name: a.name, sort_order: a.sort_order, is_active: a.is_active, metadata: a.metadata ?? {}, updated_at: at });
      }
      for (const t of p.tables ?? []) {
        if (!areas.has(t.area_id)) return err("dining_tables_area_id_fkey");
        for (const r of tables.values()) {
          if (r.id !== t.id && r.area_id === t.area_id && lower(r.label) === lower(t.label)) {
            return err("dining_tables_shop_area_label_unique");
          }
        }
        tables.set(t.id, {
          id: t.id,
          area_id: t.area_id,
          label: t.label,
          capacity: t.capacity,
          sort_order: t.sort_order,
          display_status: t.display_status,
          is_active: t.is_active,
          metadata: t.metadata ?? {},
          updated_at: at,
        });
      }
      for (const s of p.stations ?? []) {
        for (const r of stations.values()) {
          if (r.id !== s.id && lower(r.name) === lower(s.name)) return err("kitchen_stations_shop_name_unique");
        }
        stations.set(s.id, {
          id: s.id,
          name: s.name,
          station_type: s.station_type,
          sort_order: s.sort_order,
          is_active: s.is_active,
          print_config: s.print_config ?? s.future_hooks ?? {},
          updated_at: at,
        });
      }
      db.areas = areas as never;
      db.tables = tables as never;
      db.stations = stations as never;
      return { data: { ok: true }, error: null };
    }

    if (name === "shop_pull_hospitality_state") {
      return {
        data: {
          ok: true,
          server_at: at,
          areas: [...db.areas.values()],
          tables: [...db.tables.values()],
          stations: [...db.stations.values()],
          sessions: [...db.sessions.values()],
          tickets: [...db.tickets.values()],
          reservations: [],
          waitlist: [],
        },
        error: null,
      };
    }

    if (name === "shop_push_table_session") {
      if (p.table_id && !db.tables.has(p.table_id)) return err("table_sessions_table_id_fkey");
      const prev = db.sessions.get(p.id);
      if (!prev || String(prev.updated_at) <= String(p.updated_at)) db.sessions.set(p.id, { ...p });
      return { data: { ok: true }, error: null };
    }

    if (name === "shop_push_kitchen_ticket") {
      if (!db.stations.has(p.station_id)) return err("kitchen_tickets_station_id_fkey");
      const prev = db.tickets.get(p.id);
      // header (and, after the stale-items guard migration, the items) only when not older
      if (!prev || String(prev.updated_at) <= String(p.updated_at)) db.tickets.set(p.id, { ...p });
      return { data: { ok: true }, error: null };
    }
    return err(`unknown rpc ${name}`);
  }
  return { db, calls, reset, rpc };
});

vi.mock("../lib/supabase", async (orig) => {
  const actual = await orig<typeof import("../lib/supabase")>();
  return { ...actual, hasSupabaseConfig: true, supabase: { rpc: cloud.rpc, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("../lib/deviceOnline", async (orig) => ({ ...(await orig<typeof import("../lib/deviceOnline")>()), getDeviceOnline: () => true }));
vi.mock("../offline/cloudSync", async (orig) => {
  const actual = await orig<typeof import("../offline/cloudSync")>();
  return {
    ...actual,
    resolveShopCtx: async () => ({ shopId: "11111111-1111-4111-8111-111111111111", userId: "u1" }),
    refreshOpenPendingSalesFromCloud: async () => undefined,
    refreshPendingSaleFromCloud: async () => undefined,
  };
});
vi.mock("../offline/syncEngine", async (orig) => ({
  ...(await orig<typeof import("../offline/syncEngine")>()),
  enqueueSync: vi.fn(async () => undefined),
}));

import type { HospitalityFloorState, Product } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { KITCHEN_FIRE_STATION_TYPES } from "./kitchenRouting";
import {
  processHospitalitySyncOperation,
  pushTableSessionToCloud,
  resetHospitalityLayoutEnsuredForTests,
} from "../offline/hospitalityCloudSync";

const BURGER: Product = {
  id: "burger",
  name: "Burger",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 50,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
};

/** Each "device" is just its own copy of the floor; the store is a singleton so we swap it in/out. */
const devices: Record<string, HospitalityFloorState | undefined> = {};
function switchDevice(name: string, seed?: () => HospitalityFloorState) {
  resetHospitalityLayoutEnsuredForTests();
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [BURGER],
    sales: [],
    auditLogs: [],
    dayCloses: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...usePosStore.getState().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityManualKitchenFire: true,
      hospitalityFloor: devices[name] ?? seed?.() ?? defaultHospitalityFloor(),
      activeTableSessionId: null,
    },
  });
  openTestShift();
}
function saveDevice(name: string) {
  devices[name] = usePosStore.getState().preferences.hospitalityFloor;
}
const floor = () => usePosStore.getState().preferences.hospitalityFloor!;
const liveTables = () => floor().tables.filter((t) => !t.deletedAt);
const layout = () => processHospitalitySyncOperation({ type: "floor_layout" });
const pull = () => processHospitalitySyncOperation({ type: "pull", forceFull: true });

beforeEach(() => {
  cloud.reset();
  for (const k of Object.keys(devices)) delete devices[k];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

const tick = (s = 5) => vi.setSystemTime(new Date(Date.now() + s * 1000));

describe("default floor and second device", () => {
  it("a fresh shop's default floor reaches the cloud (layout, then sessions/tickets)", async () => {
    switchDevice("A");
    expect(await layout()).toBe(true);
    expect(cloud.db.areas.size).toBe(1);
    expect(cloud.db.tables.size).toBe(8);
    expect(cloud.db.stations.size).toBe(2);
  });

  it("a session pushed BEFORE any layout edit still syncs (layout is reconciled first)", async () => {
    switchDevice("A");
    const opened = usePosStore.getState().openTable({ tableId: floor().tables[0]!.id, guestCount: 2 });
    expect(opened.ok).toBe(true);
    const sessionId = (opened as { sessionId: string }).sessionId;
    // What used to happen: the session push hits the foreign key because the layout never left the device.
    const session = floor().sessions.find((s) => s.id === sessionId)!;
    expect(await pushTableSessionToCloud(session)).toBe(false);
    expect(cloud.db.sessions.size).toBe(0);
    // Through the sync queue processor the layout goes first and the session then stores.
    resetHospitalityLayoutEnsuredForTests();
    expect(await processHospitalitySyncOperation({ type: "session", sessionId })).toBe(true);
    expect(cloud.db.tables.size).toBe(8);
    expect(cloud.db.sessions.has(sessionId)).toBe(true);
  });

  it("a second device adopts the shop's floor: no duplicate floors, tables or stations", async () => {
    switchDevice("A");
    await layout();
    saveDevice("A");
    const aTableIds = new Set(liveTables().map((t) => t.id));

    switchDevice("B"); // its own random-id default seed
    expect(liveTables().some((t) => aTableIds.has(t.id))).toBe(false);
    expect(await pull()).toBe(true);
    expect(floor().areas).toHaveLength(1);
    expect(liveTables()).toHaveLength(8);
    expect(liveTables().every((t) => aTableIds.has(t.id))).toBe(true);
    expect(floor().stations).toHaveLength(2);

    // pushing from B afterwards must not create a second floor in the cloud
    expect(await layout()).toBe(true);
    expect(cloud.db.areas.size).toBe(1);
    expect(cloud.db.tables.size).toBe(8);
    expect(cloud.db.stations.size).toBe(2);
  });

  it("a device with a customised or busy floor is never replaced by another device's layout", async () => {
    switchDevice("A");
    await layout();
    saveDevice("A");
    switchDevice("B");
    usePosStore.getState().addDiningTable({ areaId: floor().areas[0]!.id, label: "Patio 1", capacity: 2 });
    const before = liveTables().map((t) => t.id);
    await pull();
    for (const id of before) expect(floor().tables.some((t) => t.id === id)).toBe(true);
  });

  it("second device hydrates the same open order and kitchen tickets (no duplicates)", async () => {
    switchDevice("A");
    const opened = usePosStore.getState().openTable({ tableId: floor().tables[0]!.id, guestCount: 2 });
    const sessionId = (opened as { sessionId: string }).sessionId;
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER, quantity: 2 });
    usePosStore.getState().saveTableBill();
    const fired = usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES);
    expect(fired.ticketsFired).toBe(1);
    const ticketId = floor().kitchenTickets![0]!.id;
    await processHospitalitySyncOperation({ type: "session", sessionId });
    await processHospitalitySyncOperation({ type: "ticket", ticketId });
    // the same op delivered twice must stay one row
    await processHospitalitySyncOperation({ type: "ticket", ticketId });
    expect(cloud.db.tickets.size).toBe(1);
    saveDevice("A");

    switchDevice("B");
    await pull();
    expect(floor().sessions.filter((s) => s.id === sessionId)).toHaveLength(1);
    expect(floor().kitchenTickets!.filter((t) => t.id === ticketId)).toHaveLength(1);
    expect(liveTables()).toHaveLength(8);
  });
});

describe("deleted tables are not resurrected", () => {
  async function twoDevicesWithLayout() {
    switchDevice("A");
    await layout();
    saveDevice("A");
    switchDevice("B");
    await pull();
    saveDevice("B");
  }

  it("a table deleted on device A stays deleted on B and after every later pull", async () => {
    await twoDevicesWithLayout();
    switchDevice("A");
    const victim = floor().tables.find((t) => t.label === "Table 8")!;
    expect(usePosStore.getState().removeDiningTable(victim.id).ok).toBe(true);
    expect(await layout()).toBe(true);
    expect(cloud.db.tables.get(victim.id)!.is_active).toBe(false);
    expect(cloud.db.tables.get(victim.id)!.metadata.deletedAt).toBeTruthy();
    saveDevice("A");

    switchDevice("B"); // still has the live copy
    expect(liveTables()).toHaveLength(8);
    await pull();
    expect(liveTables()).toHaveLength(7);
    await pull();
    await pull();
    expect(liveTables()).toHaveLength(7);
    expect(floor().tables.find((t) => t.id === victim.id)!.isActive).toBe(false);
  });

  it("a STALE device that pushes its layout does not bring the deleted table back in the cloud", async () => {
    await twoDevicesWithLayout();
    switchDevice("A");
    const victim = floor().tables.find((t) => t.label === "Table 8")!;
    usePosStore.getState().removeDiningTable(victim.id);
    await layout();
    saveDevice("A");

    switchDevice("B"); // never pulled since A deleted the table
    expect(liveTables()).toHaveLength(8);
    usePosStore.getState().addDiningTable({ areaId: floor().areas[0]!.id, label: "Patio 1", capacity: 2 });
    expect(await layout()).toBe(true); // pull-first merges the delete before pushing
    expect(cloud.db.tables.get(victim.id)!.is_active).toBe(false);
    expect(liveTables().some((t) => t.id === victim.id)).toBe(false);
  });

  it("the label of a deleted table can be reused without breaking the layout push", async () => {
    await twoDevicesWithLayout();
    switchDevice("A");
    const victim = floor().tables.find((t) => t.label === "Table 8")!;
    usePosStore.getState().removeDiningTable(victim.id);
    await layout();
    usePosStore.getState().addDiningTable({ areaId: victim.areaId, label: "Table 8", capacity: 4 });
    expect(await layout()).toBe(true);
    expect(liveTables().filter((t) => t.label === "Table 8")).toHaveLength(1);
    expect([...cloud.db.tables.values()].filter((r) => r.is_active).length).toBe(8);
  });

  it("a brand-new device gets the layout without the deleted table", async () => {
    await twoDevicesWithLayout();
    switchDevice("A");
    usePosStore.getState().removeDiningTable(floor().tables.find((t) => t.label === "Table 8")!.id);
    await layout();
    switchDevice("C");
    await pull();
    expect(liveTables()).toHaveLength(7);
    expect(floor().areas.filter((a) => !a.deletedAt)).toHaveLength(1);
  });

  it("a table with an open order cannot be deleted; an area with one cannot either", async () => {
    switchDevice("A");
    const t0 = floor().tables[0]!;
    expect(usePosStore.getState().openTable({ tableId: t0.id, guestCount: 2 }).ok).toBe(true);
    expect(usePosStore.getState().removeDiningTable(t0.id).ok).toBe(false);
    expect(usePosStore.getState().removeDiningArea(t0.areaId).ok).toBe(false);
    expect(liveTables()).toHaveLength(8);
  });
});

describe("kitchen tickets across two devices — the newest legitimate state survives", () => {
  const status = (id: string) => floor().kitchenTickets!.find((t) => t.id === id)?.status;
  const ticketOp = (ticketId: string) => processHospitalitySyncOperation({ type: "ticket", ticketId });
  const advance = (id: string, times = 1) => {
    for (let i = 0; i < times; i++) {
      tick();
      usePosStore.getState().advanceKitchenTicket(id);
    }
  };

  /** Device A fires one ticket and syncs it; B pulls it. Returns the ticket id. */
  async function firedOnAAndPulledOnB() {
    switchDevice("A");
    const opened = usePosStore.getState().openTable({ tableId: floor().tables[0]!.id, guestCount: 2 });
    const sessionId = (opened as { sessionId: string }).sessionId;
    usePosStore.getState().addHospitalityDraftLine({ product: BURGER, quantity: 1 });
    usePosStore.getState().saveTableBill();
    expect(usePosStore.getState().fireTableStationTickets(KITCHEN_FIRE_STATION_TYPES).ticketsFired).toBe(1);
    const id = floor().kitchenTickets![0]!.id;
    await processHospitalitySyncOperation({ type: "session", sessionId });
    expect(await ticketOp(id)).toBe(true);
    saveDevice("A");
    switchDevice("B");
    await pull();
    saveDevice("B");
    return id;
  }

  const completedSales = () => usePosStore.getState().sales.filter((s) => s.status === "completed" || !s.status).length;

  it("new ticket -> preparing -> ready -> served -> completed propagates in both directions", async () => {
    const id = await firedOnAAndPulledOnB();
    switchDevice("B");
    expect(status(id)).toBe("queued");

    advance(id, 2); // queued -> accepted -> preparing
    expect(status(id)).toBe("preparing");
    await ticketOp(id);
    saveDevice("B");

    switchDevice("A");
    await pull();
    expect(status(id)).toBe("preparing");
    advance(id, 2); // cooking -> ready
    expect(status(id)).toBe("ready");
    await ticketOp(id);
    saveDevice("A");

    switchDevice("B");
    await pull();
    expect(status(id)).toBe("ready");
    advance(id, 3); // picked_up -> served -> completed
    expect(status(id)).toBe("completed");
    await ticketOp(id);
    saveDevice("B");

    switchDevice("A");
    await pull();
    expect(status(id)).toBe("completed");
    expect(cloud.db.tickets.get(id)!.status).toBe("completed");
  });

  it("a cancel wins over a stale live copy, before and after the stale device pushes", async () => {
    const id = await firedOnAAndPulledOnB();
    switchDevice("A");
    tick();
    usePosStore.getState().cancelKitchenTicket(id);
    expect(status(id)).toBe("cancelled");
    await ticketOp(id);
    saveDevice("A");

    switchDevice("B"); // stale: still "queued", has not pulled
    expect(status(id)).toBe("queued");
    await ticketOp(id); // its stale push must not reopen the ticket in the cloud
    expect(cloud.db.tickets.get(id)!.status).toBe("cancelled");
    await pull();
    expect(status(id)).toBe("cancelled");
  });

  it("a stale device advancing an OLD copy cannot reopen a cancelled ticket", async () => {
    const id = await firedOnAAndPulledOnB();
    switchDevice("A");
    tick(60);
    usePosStore.getState().cancelKitchenTicket(id);
    await ticketOp(id);
    saveDevice("A");

    switchDevice("B");
    advance(id, 1); // B (offline, stale) accepts the ticket it still thinks is live
    await ticketOp(id);
    await pull();
    expect(status(id)).toBe("cancelled");
    expect(cloud.db.tickets.get(id)!.status).toBe("cancelled");
  });

  it("a recall (ready -> preparing) reaches the other device instead of being reverted", async () => {
    const id = await firedOnAAndPulledOnB();
    switchDevice("A");
    advance(id, 4); // -> ready
    expect(status(id)).toBe("ready");
    await ticketOp(id);
    saveDevice("A");
    switchDevice("B");
    await pull();
    expect(status(id)).toBe("ready");
    saveDevice("B");

    switchDevice("A");
    tick();
    expect(usePosStore.getState().recallKitchenTicket(id, "wrong dish").ok).toBe(true);
    expect(status(id)).toBe("preparing");
    await ticketOp(id);
    saveDevice("A");

    switchDevice("B");
    await pull();
    expect(status(id)).toBe("preparing");
    await pull(); // and it stays that way
    expect(status(id)).toBe("preparing");
  });

  it("kitchen sync never creates a financial event", async () => {
    const id = await firedOnAAndPulledOnB();
    switchDevice("A");
    const revenueBefore = usePosStore.getState().sales.filter((s) => s.status === "completed").length;
    const stockBefore = usePosStore.getState().products[0]!.stockOnHand;
    advance(id, 7);
    tick();
    await ticketOp(id);
    switchDevice("B");
    await pull();
    expect(completedSales()).toBe(revenueBefore);
    expect(usePosStore.getState().products[0]!.stockOnHand).toBe(stockBefore);
    expect(usePosStore.getState().stockMovements.filter((m) => m.productId === "burger")).toHaveLength(0);
  });
});
