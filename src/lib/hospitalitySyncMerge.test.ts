import { describe, expect, it } from "vitest";
import type { KitchenTicket, TableSession } from "../types";
import { defaultHospitalityFloor } from "./hospitality";
import { mergeKitchenTicketMonotonic } from "./kitchenProduction";
import { looksLikeUntouchedSeedFloor, mergeLayoutRow, mergeRemoteHospitalityFloor } from "../offline/hospitalityCloudSync";
import { addDiningTable, removeDiningTable, renameDiningArea } from "./hospitalityFloorEditor";

function session(over: Partial<TableSession>): TableSession {
  return {
    id: "s1",
    tableId: "t1",
    saleId: "sale1",
    status: "open",
    guestCount: 2,
    openedAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
    ...over,
  } as TableSession;
}

function ticket(over: Partial<KitchenTicket>): KitchenTicket {
  return {
    id: "k1",
    tableSessionId: "s1",
    saleId: "sale1",
    stationId: "st1",
    stationType: "kitchen",
    status: "queued",
    ticketNumber: 1,
    firedAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
    tableLabel: "T1",
    items: [],
    statusHistory: [],
    ...over,
  } as KitchenTicket;
}

const emptyRemote = { areas: [], tables: [], stations: [], tickets: [] };

describe("session merge across devices — newer copy wins", () => {
  it("keeps the newer LOCAL session when the remote copy is older", () => {
    const local = { ...defaultHospitalityFloor(), sessions: [session({ status: "closed", updatedAt: "2026-09-18T11:00:00.000Z" })] };
    const merged = mergeRemoteHospitalityFloor(local, {
      ...emptyRemote,
      sessions: [session({ status: "open", updatedAt: "2026-09-18T10:30:00.000Z" })],
    });
    expect(merged.sessions.find((s) => s.id === "s1")?.status).toBe("closed");
  });

  it("takes the newer REMOTE session when the local copy is older (settled on another device)", () => {
    const local = { ...defaultHospitalityFloor(), sessions: [session({ status: "open", updatedAt: "2026-09-18T10:30:00.000Z" })] };
    const merged = mergeRemoteHospitalityFloor(local, {
      ...emptyRemote,
      sessions: [session({ status: "closed", updatedAt: "2026-09-18T11:00:00.000Z" })],
    });
    expect(merged.sessions.find((s) => s.id === "s1")?.status).toBe("closed");
  });
});

describe("kitchen ticket merge across devices", () => {
  it("a cancelled ticket beats a stale live copy in both directions", () => {
    const cancelled = ticket({ status: "cancelled", updatedAt: "2026-09-18T10:05:00.000Z" });
    const stale = ticket({ status: "preparing", updatedAt: "2026-09-18T10:02:00.000Z" });
    expect(mergeKitchenTicketMonotonic(cancelled, stale).status).toBe("cancelled");
    expect(mergeKitchenTicketMonotonic(stale, cancelled).status).toBe("cancelled");
  });

  it("a recall (ready -> preparing) propagates instead of being reverted", () => {
    const recall = { at: "2026-09-18T10:20:00.000Z", reason: "wrong dish", fromStatus: "ready", toStatus: "preparing" };
    const recalled = ticket({ status: "preparing", updatedAt: "2026-09-18T10:20:00.000Z", recallHistory: [recall] as never });
    const stale = ticket({ status: "ready", updatedAt: "2026-09-18T10:15:00.000Z" });
    expect(mergeKitchenTicketMonotonic(stale, recalled).status).toBe("preparing");
    expect(mergeKitchenTicketMonotonic(recalled, stale).status).toBe("preparing");
  });

  it("the same recall seen from both devices is counted once", () => {
    const recall = { at: "2026-09-18T10:20:00.000Z", reason: "wrong dish", fromStatus: "ready", toStatus: "preparing" };
    const a = ticket({ status: "preparing", updatedAt: "2026-09-18T10:20:00.000Z", recallHistory: [recall] as never });
    const b = ticket({ status: "preparing", updatedAt: "2026-09-18T10:20:00.000Z", recallHistory: [recall] as never });
    expect(mergeKitchenTicketMonotonic(a, b).recallHistory).toHaveLength(1);
  });

  it("normal forward progress is still monotonic", () => {
    const ready = ticket({ status: "ready", updatedAt: "2026-09-18T10:10:00.000Z" });
    const preparing = ticket({ status: "preparing", updatedAt: "2026-09-18T10:12:00.000Z" });
    expect(mergeKitchenTicketMonotonic(ready, preparing).status).toBe("ready");
    expect(mergeKitchenTicketMonotonic(preparing, ready).status).toBe("ready");
  });
});

describe("layout row merge — deletion tombstones win", () => {
  type Row = { id: string; label: string; isActive: boolean; deletedAt: string | null; extra?: number };
  const live: Row = { id: "t1", label: "Table 8", isActive: true, deletedAt: null };
  const tomb: Row = { id: "t1", label: "Table 8 (deleted t1)", isActive: false, deletedAt: "2026-09-18T10:00:00.000Z" };

  it("a local tombstone beats a stale live remote copy (label and isActive too)", () => {
    expect(mergeLayoutRow(tomb, live)).toEqual(tomb);
  });

  it("a remote tombstone beats a stale live local copy", () => {
    expect(mergeLayoutRow(live, tomb)).toEqual(tomb);
  });

  it("without a tombstone it is the plain per-id union", () => {
    expect(mergeLayoutRow<Row>({ ...live, extra: 1 }, { id: "t1", label: "Renamed", isActive: true, deletedAt: null })).toMatchObject({
      label: "Renamed",
      extra: 1,
    });
  });
});

describe("untouched seed floor detection", () => {
  it("the auto-created default floor qualifies", () => {
    expect(looksLikeUntouchedSeedFloor(defaultHospitalityFloor())).toBe(true);
  });

  it("any real edit or activity disqualifies it", () => {
    const seed = defaultHospitalityFloor();
    expect(looksLikeUntouchedSeedFloor(addDiningTable(seed, { areaId: seed.areas[0]!.id, label: "Patio 1" }))).toBe(false);
    expect(looksLikeUntouchedSeedFloor(renameDiningArea(seed, seed.areas[0]!.id, "Garden"))).toBe(false);
    expect(looksLikeUntouchedSeedFloor(removeDiningTable(seed, seed.tables[0]!.id))).toBe(false);
    expect(looksLikeUntouchedSeedFloor({ ...seed, sessions: [session({})] })).toBe(false);
    expect(looksLikeUntouchedSeedFloor({ ...seed, kitchenTickets: [ticket({})] })).toBe(false);
  });
});

describe("removing tables, areas and stations is a soft delete", () => {
  it("frees the label so the same name can be created again, and hides nothing else", () => {
    const seed = defaultHospitalityFloor();
    const victim = seed.tables[7]!;
    const after = removeDiningTable(seed, victim.id);
    const row = after.tables.find((x) => x.id === victim.id)!;
    expect(row.deletedAt).toBeTruthy();
    expect(row.isActive).toBe(false);
    expect(row.label).not.toBe(victim.label);
    expect(after.tables).toHaveLength(seed.tables.length); // tombstone kept for sync
    const again = addDiningTable(after, { areaId: victim.areaId, label: victim.label });
    expect(again.tables.filter((x) => !x.deletedAt && x.label === victim.label)).toHaveLength(1);
  });

  it("refuses to remove a table with a live order", () => {
    const seed = defaultHospitalityFloor();
    const withOrder = { ...seed, sessions: [session({ tableId: seed.tables[0]!.id, status: "open" })] };
    expect(removeDiningTable(withOrder, seed.tables[0]!.id)).toBe(withOrder);
  });
});
