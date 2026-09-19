/**
 * Round 3 / P10 — reservation and waitlist status transitions are guarded.
 *
 * Before: any action ran on any status. A cancelled reservation could be "confirmed" back to life
 * (re-reserving its table), a seated one cancelled or no-showed while its order was open, any status
 * could be forced through an edit patch, and a table could be opened for a cancelled reservation or an
 * already-seated waitlist entry (the lifecycle change was then silently skipped or overwritten).
 * Two devices holding different states also let the older-looking copy win.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { HospitalityFloorState, TableReservation, WaitlistEntry } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { dateKeyKampala } from "./datesUg";
import { defaultHospitalityFloor } from "./hospitality";
import {
  RESERVATION_TRANSITIONS,
  WAITLIST_TRANSITIONS,
  checkReservationTransition,
  checkWaitlistTransition,
  reservationStatusRank,
} from "./hospitalityFrontOfHouse";
import { mergeRemoteHospitalityFloor } from "../offline/hospitalityCloudSync";

const st = () => usePosStore.getState();
const floor = () => st().preferences.hospitalityFloor!;
const reservation = (id: string) => floor().reservations!.find((r) => r.id === id)!;
const entry = (id: string) => floor().waitlist!.find((w) => w.id === id)!;
const tableId = (i: number) => floor().tables[i]!.id;
const audits = (type: string) => (floor().hospitalityAuditLog ?? []).filter((e) => e.type === type).length;

function newReservation(over: Partial<TableReservation> = {}): string {
  const r = st().createTableReservation({
    guestName: "Guest",
    phone: "0700000000",
    guestCount: 2,
    reservationDate: dateKeyKampala(new Date()),
    reservationTime: "19:00",
    preferredTableId: tableId(0),
    isVip: false,
    ...over,
  });
  expect(r.ok).toBe(true);
  return (r as { reservationId: string }).reservationId;
}

function newWaiting(): string {
  const r = st().addWaitlistEntry({
    name: "Walk-in",
    guestCount: 2,
    arrivalTime: new Date().toISOString(),
    priority: "normal",
    source: "walk_in",
  });
  expect(r.ok).toBe(true);
  return (r as { entryId: string }).entryId;
}

beforeEach(() => {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
    products: [],
    sales: [],
    auditLogs: [],
    draftLines: [],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    preferences: {
      ...st().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityFloor: defaultHospitalityFloor(),
      activeTableSessionId: null,
    },
  });
  openTestShift();
});

describe("the transition tables", () => {
  it("terminal states have no way out; seated can only complete", () => {
    expect(RESERVATION_TRANSITIONS.cancelled).toEqual([]);
    expect(RESERVATION_TRANSITIONS.no_show).toEqual([]);
    expect(RESERVATION_TRANSITIONS.completed).toEqual([]);
    expect(RESERVATION_TRANSITIONS.seated).toEqual(["completed"]);
    expect(WAITLIST_TRANSITIONS.seated).toEqual([]);
    expect(WAITLIST_TRANSITIONS.cancelled).toEqual([]);
  });
  it("ranks only move forward", () => {
    const order = ["pending", "confirmed", "cancelled", "seated", "completed"].map(reservationStatusRank);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(reservationStatusRank("waiting")).toBe(0);
  });
});

describe("reservations", () => {
  it("a cancelled reservation cannot be confirmed back to life, and its table stays free", () => {
    const id = newReservation();
    expect(st().confirmTableReservation(id).ok).toBe(true);
    expect(st().cancelTableReservation(id, "guest called").ok).toBe(true);
    expect(floor().tables[0]!.displayStatus).not.toBe("reserved");

    const res = st().confirmTableReservation(id);
    expect(res).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(reservation(id).status).toBe("cancelled");
    expect(floor().tables[0]!.displayStatus).not.toBe("reserved");
  });

  it("repeating a transition is idempotent: no error, no second audit row, no timestamp churn", () => {
    const id = newReservation();
    expect(st().confirmTableReservation(id).ok).toBe(true);
    const before = reservation(id);
    const confirmedAudits = audits("reservation_confirmed");
    expect(st().confirmTableReservation(id)).toEqual({ ok: true });
    expect(reservation(id)).toEqual(before);
    expect(audits("reservation_confirmed")).toBe(confirmedAudits);

    expect(st().cancelTableReservation(id, "x").ok).toBe(true);
    const cancelledAudits = audits("reservation_cancelled");
    expect(st().cancelTableReservation(id, "double tap")).toEqual({ ok: true });
    expect(audits("reservation_cancelled")).toBe(cancelledAudits);
    expect(reservation(id).notes).toBe("x"); // the first reason is kept
  });

  it("a seated reservation cannot be cancelled, no-showed, edited or pushed back", () => {
    const id = newReservation();
    const opened = st().openTable({ tableId: tableId(0), guestCount: 2, reservationId: id });
    expect(opened.ok).toBe(true);
    expect(reservation(id).status).toBe("seated");

    expect(st().cancelTableReservation(id, "oops")).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(st().markReservationNoShow(id)).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(st().updateTableReservation(id, { status: "pending" })).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(st().updateTableReservation(id, { guestName: "Someone else" })).toEqual({ ok: false, errorKey: "reservationNotEditable" });
    expect(reservation(id).status).toBe("seated");
    expect(reservation(id).guestName).toBe("Guest");
    expect(reservation(id).seatedSessionId).toBe((opened as { sessionId: string }).sessionId);
  });

  it("an edit patch cannot force an illegal status, but a normal edit of a pending reservation works", () => {
    const id = newReservation();
    expect(st().updateTableReservation(id, { status: "completed" })).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(reservation(id).status).toBe("pending");
    expect(st().updateTableReservation(id, { preferredTableId: tableId(1), guestCount: 4 }).ok).toBe(true);
    expect(reservation(id).preferredTableId).toBe(tableId(1));
    expect(reservation(id).guestCount).toBe(4);
    expect(st().updateTableReservation("does-not-exist", { guestCount: 3 })).toEqual({ ok: false, errorKey: "reservationNotFound" });
  });

  it("no-show is final: it can be neither confirmed nor cancelled afterwards", () => {
    const id = newReservation();
    expect(st().markReservationNoShow(id).ok).toBe(true);
    expect(reservation(id).status).toBe("no_show");
    expect(st().confirmTableReservation(id).ok).toBe(false);
    expect(st().cancelTableReservation(id, "late").ok).toBe(false);
    expect(reservation(id).status).toBe("no_show");
  });
});

describe("opening a table for a reservation / waitlist entry", () => {
  it("refuses a cancelled reservation BEFORE creating any order", () => {
    const id = newReservation();
    st().cancelTableReservation(id, "guest called");
    const sessionsBefore = floor().sessions.length;
    const salesBefore = st().sales.length;
    const res = st().openTable({ tableId: tableId(0), guestCount: 2, reservationId: id });
    expect(res).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(floor().sessions).toHaveLength(sessionsBefore);
    expect(st().sales).toHaveLength(salesBefore);
    expect(st().activePendingSaleId).toBeNull();
    expect(reservation(id).status).toBe("cancelled");
  });

  it("an already-seated reservation cannot seat a second party on another table", () => {
    const id = newReservation();
    expect(st().openTable({ tableId: tableId(0), guestCount: 2, reservationId: id }).ok).toBe(true);
    const sessionsBefore = floor().sessions.length;
    const again = st().openTable({ tableId: tableId(1), guestCount: 2, reservationId: id });
    expect(again.ok).toBe(false);
    expect(floor().sessions).toHaveLength(sessionsBefore);
  });

  it("an unknown reservation id is refused, not silently ignored", () => {
    const res = st().openTable({ tableId: tableId(0), guestCount: 2, reservationId: "nope" });
    expect(res).toEqual({ ok: false, errorKey: "reservationNotFound" });
    expect(floor().sessions).toHaveLength(0);
  });

  it("a pending/confirmed reservation seats normally", () => {
    const id = newReservation();
    st().confirmTableReservation(id);
    expect(st().openTable({ tableId: tableId(0), guestCount: 2, reservationId: id }).ok).toBe(true);
    expect(reservation(id).status).toBe("seated");
  });
});

describe("waitlist", () => {
  it("seat once; cancelling or re-seating a seated entry is refused", () => {
    const id = newWaiting();
    const opened = st().openTable({ tableId: tableId(0), guestCount: 2, waitlistEntryId: id });
    expect(opened.ok).toBe(true);
    expect(entry(id).status).toBe("seated");
    expect(st().cancelWaitlistEntry(id)).toEqual({ ok: false, errorKey: "waitlistInvalidTransition" });
    expect(entry(id).status).toBe("seated");
    const sessions = floor().sessions.length;
    expect(st().openTable({ tableId: tableId(1), guestCount: 2, waitlistEntryId: id }).ok).toBe(false);
    expect(floor().sessions).toHaveLength(sessions);
  });

  it("a cancelled entry cannot be seated; cancelling twice is a harmless no-op", () => {
    const id = newWaiting();
    expect(st().cancelWaitlistEntry(id).ok).toBe(true);
    const stamp = entry(id).updatedAt;
    expect(st().cancelWaitlistEntry(id)).toEqual({ ok: true });
    expect(entry(id).updatedAt).toBe(stamp);
    const res = st().openTable({ tableId: tableId(0), guestCount: 2, waitlistEntryId: id });
    expect(res).toEqual({ ok: false, errorKey: "waitlistInvalidTransition" });
    expect(floor().sessions).toHaveLength(0);
    expect(entry(id).status).toBe("cancelled");
  });

  it("unknown entry ids are refused", () => {
    expect(st().cancelWaitlistEntry("nope")).toEqual({ ok: false, errorKey: "waitlistNotFound" });
    expect(st().openTable({ tableId: tableId(0), guestCount: 2, waitlistEntryId: "nope" })).toEqual({ ok: false, errorKey: "waitlistNotFound" });
  });
});

describe("pure checks", () => {
  it("checkReservationTransition / checkWaitlistTransition", () => {
    const f = { reservations: [{ id: "r", status: "confirmed" }], waitlist: [{ id: "w", status: "waiting" }] } as unknown as HospitalityFloorState;
    expect(checkReservationTransition(f, "r", "cancelled")).toEqual({ ok: true, noop: false });
    expect(checkReservationTransition(f, "r", "confirmed")).toEqual({ ok: true, noop: true });
    expect(checkReservationTransition(f, "r", "pending")).toEqual({ ok: false, errorKey: "reservationInvalidTransition" });
    expect(checkWaitlistTransition(f, "w", "seated")).toEqual({ ok: true, noop: false });
    expect(checkWaitlistTransition(f, "zz", "seated")).toEqual({ ok: false, errorKey: "waitlistNotFound" });
  });
});

describe("two devices: the further-along copy wins whatever its timestamp says", () => {
  const base = (): HospitalityFloorState => ({ ...defaultHospitalityFloor() });
  const res = (status: TableReservation["status"], updatedAt: string): TableReservation => ({
    id: "res-1",
    reservationNumber: 1,
    guestName: "G",
    phone: "1",
    guestCount: 2,
    reservationDate: "2026-09-19",
    reservationTime: "19:00",
    isVip: false,
    status,
    createdAt: "2026-09-19T08:00:00.000Z",
    updatedAt,
  });
  const wl = (status: WaitlistEntry["status"], updatedAt: string): WaitlistEntry => ({
    id: "wl-1",
    name: "W",
    guestCount: 2,
    arrivalTime: "2026-09-19T08:00:00.000Z",
    priority: "normal",
    source: "walk_in",
    status,
    createdAt: "2026-09-19T08:00:00.000Z",
    updatedAt,
  });
  const merge = (local: Partial<HospitalityFloorState>, remote: { reservations?: TableReservation[]; waitlist?: WaitlistEntry[] }) =>
    mergeRemoteHospitalityFloor({ ...base(), ...local }, { areas: [], tables: [], sessions: [], stations: [], tickets: [], ...remote });

  it("a stale/clock-skewed 'confirmed' with a NEWER timestamp cannot un-cancel a reservation", () => {
    const merged = merge(
      { reservations: [res("cancelled", "2026-09-19T09:00:00.000Z")] },
      { reservations: [res("confirmed", "2026-09-19T12:00:00.000Z")] },
    );
    expect(merged.reservations![0]!.status).toBe("cancelled");
  });

  it("seated beats cancelled (the party is at a table) in either direction", () => {
    const a = merge({ reservations: [res("seated", "2026-09-19T09:00:00.000Z")] }, { reservations: [res("cancelled", "2026-09-19T12:00:00.000Z")] });
    const b = merge({ reservations: [res("cancelled", "2026-09-19T12:00:00.000Z")] }, { reservations: [res("seated", "2026-09-19T09:00:00.000Z")] });
    expect(a.reservations![0]!.status).toBe("seated");
    expect(b.reservations![0]!.status).toBe("seated");
  });

  it("same rank: the newer edit still wins", () => {
    const merged = merge(
      { reservations: [{ ...res("confirmed", "2026-09-19T09:00:00.000Z"), guestCount: 2 }] },
      { reservations: [{ ...res("confirmed", "2026-09-19T12:00:00.000Z"), guestCount: 6 }] },
    );
    expect(merged.reservations![0]!.guestCount).toBe(6);
  });

  it("a waitlist entry that was seated elsewhere is not resurrected by an older 'waiting' copy", () => {
    const merged = merge(
      { waitlist: [wl("waiting", "2026-09-19T12:00:00.000Z")] },
      { waitlist: [wl("seated", "2026-09-19T09:00:00.000Z")] },
    );
    expect(merged.waitlist![0]!.status).toBe("seated");
  });
});
