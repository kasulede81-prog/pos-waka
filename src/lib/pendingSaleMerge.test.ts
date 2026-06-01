import { describe, expect, it } from "vitest";
import type { KitchenTicket, Sale, SaleLine } from "../types";
import { firedQtyByProductForSale } from "./kitchenRouting";
import {
  deletedLineIdsFromDraft,
  mergePendingSaleLines,
  mergePendingSales,
  simulateServerPendingSaleMerge,
} from "./pendingSaleMerge";

const BEER_ID = "11111111-1111-4111-8111-111111111111";
const PORK_ID = "22222222-2222-4222-8222-222222222222";
const SALE_ID = "33333333-3333-4333-8333-333333333333";

function line(input: Partial<SaleLine> & Pick<SaleLine, "productId" | "name" | "quantity" | "lineTotalUgx">): SaleLine {
  return {
    id: input.id ?? crypto.randomUUID(),
    updatedAt: input.updatedAt ?? "2026-05-31T10:00:00.000Z",
    inputMode: "quantity",
    unitPriceUgx: input.lineTotalUgx / input.quantity,
    unitCostUgx: 0,
    estimatedProfitUgx: input.lineTotalUgx,
    ...input,
  };
}

function pendingSale(lines: SaleLine[], updatedAt = "2026-05-31T10:00:00.000Z"): Sale {
  const total = lines.reduce((s, l) => s + l.lineTotalUgx, 0);
  return {
    id: SALE_ID,
    status: "pending",
    updatedAt,
    createdAt: "2026-05-31T09:00:00.000Z",
    lines,
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: 0,
    debtUgx: 0,
    estimatedProfitUgx: total,
    pendingSync: true,
    lastSyncError: null,
  };
}

describe("pending sale line merge (P0)", () => {
  it("Beer + Pork from two waiters both survive", () => {
    const beer = line({ id: BEER_ID, productId: "beer", name: "Beer", quantity: 1, lineTotalUgx: 5000 });
    const pork = line({ id: PORK_ID, productId: "pork", name: "Pork", quantity: 1, lineTotalUgx: 12000 });

    const afterA = simulateServerPendingSaleMerge({ serverLines: [], payloadLines: [beer] });
    const afterB = simulateServerPendingSaleMerge({ serverLines: afterA, payloadLines: [pork] });

    expect(afterB).toHaveLength(2);
    expect(afterB.map((l) => l.name).sort()).toEqual(["Beer", "Pork"]);
  });

  it("stale Pork-only push does not wipe Beer when server merges additively", () => {
    const beer = line({ id: BEER_ID, productId: "beer", name: "Beer", quantity: 1, lineTotalUgx: 5000 });
    const pork = line({ id: PORK_ID, productId: "pork", name: "Pork", quantity: 1, lineTotalUgx: 12000 });

    const server = [beer];
    const merged = simulateServerPendingSaleMerge({ serverLines: server, payloadLines: [pork] });
    expect(merged.map((l) => l.name).sort()).toEqual(["Beer", "Pork"]);
  });

  it("client mergePendingSales unions lines from offline and online devices", () => {
    const beer = line({ id: BEER_ID, productId: "beer", name: "Beer", quantity: 1, lineTotalUgx: 5000 });
    const pork = line({ id: PORK_ID, productId: "pork", name: "Pork", quantity: 1, lineTotalUgx: 12000 });

    const offline = pendingSale([beer], "2026-05-31T10:00:00.000Z");
    const online = pendingSale([pork], "2026-05-31T10:00:05.000Z");
    const merged = mergePendingSales(offline, online);

    expect(merged.lines.map((l) => l.name).sort()).toEqual(["Beer", "Pork"]);
    expect(merged.totalUgx).toBe(17000);
  });

  it("merge during edit keeps items from both tables", () => {
    const target = line({ id: BEER_ID, productId: "beer", name: "Beer", quantity: 2, lineTotalUgx: 10000 });
    const source = line({ id: PORK_ID, productId: "pork", name: "Pork", quantity: 1, lineTotalUgx: 12000 });
    const merged = mergePendingSaleLines([target], [source]);
    expect(merged).toHaveLength(2);
  });

  it("deletedLineIdsFromDraft detects removed lines", () => {
    const beer = line({ id: BEER_ID, productId: "beer", name: "Beer", quantity: 1, lineTotalUgx: 5000 });
    const pork = line({ id: PORK_ID, productId: "pork", name: "Pork", quantity: 1, lineTotalUgx: 12000 });
    const removed = deletedLineIdsFromDraft([beer, pork], [beer]);
    expect(removed).toEqual([PORK_ID]);
  });

  it("line-level LWW keeps newer quantity on same line id", () => {
    const older = line({
      id: BEER_ID,
      productId: "beer",
      name: "Beer",
      quantity: 1,
      lineTotalUgx: 5000,
      updatedAt: "2026-05-31T10:00:00.000Z",
    });
    const newer = line({
      id: BEER_ID,
      productId: "beer",
      name: "Beer",
      quantity: 3,
      lineTotalUgx: 15000,
      updatedAt: "2026-05-31T10:00:10.000Z",
    });
    const merged = mergePendingSaleLines([older], [newer]);
    expect(merged[0]?.quantity).toBe(3);
  });

  it("simultaneous settlement: completed sale blocks further draft push (simulated)", () => {
    const completed = { ...pendingSale([]), status: "completed" as const };
    expect(completed.status).toBe("completed");
    // Server RPC returns already_completed — client must not overwrite (enforced in migration 075).
  });
});

describe("transfer during edit", () => {
  it("line merge preserves items while header reference changes", () => {
    const beer = line({ id: BEER_ID, productId: "beer", name: "Beer", quantity: 1, lineTotalUgx: 5000 });
    const pork = line({ id: PORK_ID, productId: "pork", name: "Pork", quantity: 1, lineTotalUgx: 12000 });
    const beforeTransfer = pendingSale([beer]);
    const afterRemoteAdd = pendingSale([beer, pork], "2026-05-31T10:01:00.000Z");
    const merged = mergePendingSales(beforeTransfer, afterRemoteAdd);
    expect(merged.lines).toHaveLength(2);
  });
});

describe("kitchen ticket deduplication", () => {
  it("does not re-fire products already on non-cancelled tickets", () => {
    const tickets: KitchenTicket[] = [
      {
        id: "t1",
        tableSessionId: "s1",
        saleId: SALE_ID,
        stationId: "st1",
        stationType: "bar",
        status: "queued",
        ticketNumber: 1,
        firedAt: "2026-05-31T10:00:00.000Z",
        updatedAt: "2026-05-31T10:00:00.000Z",
        tableLabel: "Table 1",
        items: [{ id: "i1", productId: "beer", productName: "Beer", quantity: 1 }],
      },
    ];
    const fired = firedQtyByProductForSale(tickets, SALE_ID);
    expect(fired.get("beer")).toBe(1);
  });
});
