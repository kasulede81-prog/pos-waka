import { describe, expect, it } from "vitest";
import type { HospitalityFloorState, KitchenTicket } from "../types";
import {
  advanceKitchenTicket,
  cancelKitchenTicketItem,
  computeTicketTimerUrgency,
  KITCHEN_TICKET_STATUS_FLOW,
  mergeKitchenTicketMonotonic,
  nextKitchenTicketStatus,
  recallKitchenTicket,
  statusProgressIndex,
} from "./kitchenProduction";

function ticket(partial: Partial<KitchenTicket>): KitchenTicket {
  return {
    id: "t1",
    tableSessionId: "s1",
    saleId: "sale1",
    stationId: "st1",
    stationType: "kitchen",
    status: "queued",
    ticketNumber: 1,
    firedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    tableLabel: "Table 1",
    items: [
      {
        id: "i1",
        productId: "p1",
        productName: "Burger",
        quantity: 1,
        prepTimeMinutes: 15,
        itemStatus: "active",
      },
    ],
    prepTargetMinutes: 15,
    ...partial,
  };
}

const floor: HospitalityFloorState = {
  areas: [],
  tables: [],
  sessions: [],
  stations: [{ id: "st1", name: "Kitchen", stationType: "kitchen", sortOrder: 0, isActive: true }],
  kitchenTickets: [ticket({})],
};

describe("kitchenProduction", () => {
  it("follows the full status flow", () => {
    expect(nextKitchenTicketStatus("queued")).toBe("accepted");
    expect(nextKitchenTicketStatus("accepted")).toBe("preparing");
    expect(nextKitchenTicketStatus("preparing")).toBe("cooking");
    expect(nextKitchenTicketStatus("cooking")).toBe("ready");
    expect(nextKitchenTicketStatus("ready")).toBe("picked_up");
    expect(nextKitchenTicketStatus("picked_up")).toBe("served");
    expect(nextKitchenTicketStatus("served")).toBe("completed");
    expect(nextKitchenTicketStatus("completed")).toBeNull();
    expect(KITCHEN_TICKET_STATUS_FLOW).toHaveLength(8);
  });

  it("advances ticket and records audit history", () => {
    const next = advanceKitchenTicket(floor, "t1", { label: "Chef" });
    const updated = next.kitchenTickets?.[0];
    expect(updated?.status).toBe("accepted");
    expect(updated?.acceptedAt).toBeTruthy();
    expect(updated?.statusHistory?.length).toBeGreaterThanOrEqual(1);
  });

  it("flags overdue tickets by prep target", () => {
    const overdue = ticket({ firedAt: new Date(Date.now() - 30 * 60_000).toISOString(), prepTargetMinutes: 15 });
    expect(computeTicketTimerUrgency(overdue)).toBe("overdue");
  });

  it("requires manager for post-prep item cancel", () => {
    const preparing = ticket({ status: "preparing" });
    const prepFloor = { ...floor, kitchenTickets: [preparing] };
    const denied = cancelKitchenTicketItem(prepFloor, "t1", "i1", "wrong order", undefined, false);
    expect(denied.ok).toBe(false);
    const allowed = cancelKitchenTicketItem(prepFloor, "t1", "i1", "wrong order", undefined, true);
    expect(allowed.ok).toBe(true);
    expect(allowed.floor.kitchenTickets?.[0]?.status).toBe("cancelled");
  });

  it("recalls ready tickets with reason", () => {
    const ready = ticket({ status: "ready", readyAt: new Date().toISOString() });
    const readyFloor = { ...floor, kitchenTickets: [ready] };
    const next = recallKitchenTicket(readyFloor, "t1", "needs reheating", { label: "Manager" });
    const updated = next.kitchenTickets?.[0];
    expect(updated?.status).toBe("preparing");
    expect(updated?.recallHistory?.[0]?.reason).toBe("needs reheating");
  });

  it("merges tickets monotonically without status regression", () => {
    const local = ticket({ status: "ready", updatedAt: "2026-01-01T10:00:00.000Z" });
    const remote = ticket({ status: "preparing", updatedAt: "2026-01-01T11:00:00.000Z" });
    const merged = mergeKitchenTicketMonotonic(local, remote);
    expect(statusProgressIndex(merged.status)).toBeGreaterThanOrEqual(statusProgressIndex("preparing"));
  });
});
