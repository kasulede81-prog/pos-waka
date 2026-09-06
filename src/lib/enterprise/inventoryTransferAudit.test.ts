/**
 * IC-P2-06 — successful inventory transfers must produce one shop audit event.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../../types";
import { buildAuditLogSearchIndex } from "../auditSearch";
import { applyAuditActiveCap } from "../auditActiveCap";
import { prepareAuditCloudPush } from "../investigationActorAttribution";
import { describeAuditLine } from "../activityNarrative";
import { t } from "../i18n";
import {
  collectInvestigationMatches,
  investigationShareSlice,
} from "../../features/investigation-center/lib/investigationResultScope";
import { auditEntriesToExportRows } from "../auditExport";
import {
  TransferEngineSimulator,
  type SimTransfer,
} from "./stockTransferEngine";
import {
  INVENTORY_TRANSFER_AUDIT_ACTION,
  buildInventoryTransferAuditPayload,
  inventoryTransferCorrelationId,
  recordInventoryTransferAuditIfSucceeded,
  shouldWriteInventoryTransferAudit,
  type InventoryTransferAuditSnapshot,
} from "./inventoryTransferAudit";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRANSFER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LINE_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LINE_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SRC_P1 = "11111111-1111-4111-8111-111111111111";
const SRC_P2 = "22222222-2222-4222-8222-222222222222";
const DST_P1 = "33333333-3333-4333-8333-333333333333";
const DST_P2 = "44444444-4444-4444-8444-444444444444";
const RECEIVE_ID = "55555555-5555-4555-8555-555555555555";

function snapshot(partial?: Partial<InventoryTransferAuditSnapshot>): InventoryTransferAuditSnapshot {
  return {
    transferId: TRANSFER_ID,
    phase: "dispatch",
    sourceShopId: SHOP_A,
    destinationShopId: SHOP_B,
    sourceName: "Main Store",
    destinationName: "Branch 2",
    lines: [{ productId: SRC_P1, productName: "Soda", quantity: 10, destinationProductId: DST_P1 }],
    ...partial,
  };
}

function freshSim(lines: SimTransfer["lines"] = [
  {
    id: LINE_1,
    sourceProductId: SRC_P1,
    destinationProductId: DST_P1,
    quantity: 10,
    receivedQuantity: 0,
    unitCostUgx: 0,
  },
]): TransferEngineSimulator {
  const sim = new TransferEngineSimulator();
  sim.addProduct({ id: SRC_P1, shopId: SHOP_A, stockOnHand: 100, costPricePerUnitUgx: 2000 });
  sim.addProduct({ id: SRC_P2, shopId: SHOP_A, stockOnHand: 50, costPricePerUnitUgx: 1000 });
  sim.addProduct({ id: DST_P1, shopId: SHOP_B, stockOnHand: 10, costPricePerUnitUgx: 2000 });
  sim.addProduct({ id: DST_P2, shopId: SHOP_B, stockOnHand: 0, costPricePerUnitUgx: 0 });
  sim.upsertDraft({
    id: TRANSFER_ID,
    fromShopId: SHOP_A,
    toShopId: SHOP_B,
    status: "draft",
    lines,
  });
  return sim;
}

function entryFromWrite(
  summary: string,
  payload: Record<string, unknown>,
  extras: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    id: extras.id ?? `audit-${payload.correlationId ?? "xfer"}`,
    at: extras.at ?? "2026-09-06T10:00:00.000Z",
    actorUserId: extras.actorUserId ?? "staff-1",
    actorName: extras.actorName ?? "Amina",
    role: extras.role ?? "manager",
    action: INVENTORY_TRANSFER_AUDIT_ACTION,
    payloadSummary: summary,
    payload,
  };
}

function recorder(existing: AuditLogEntry[] = []) {
  const logs = [...existing];
  const writeAudit = (_action: typeof INVENTORY_TRANSFER_AUDIT_ACTION, summary: string, payload: Record<string, unknown>) => {
    logs.push(entryFromWrite(summary, payload, { id: `audit-${logs.length + 1}` }));
  };
  return {
    logs,
    write: (result: { ok: boolean; idempotent?: boolean; error?: string }, snap?: InventoryTransferAuditSnapshot) =>
      recordInventoryTransferAuditIfSucceeded(result, snap, { writeAudit, existingLogs: logs }),
  };
}

function commitDispatch(sim: TransferEngineSimulator, snap = snapshot(), rec = recorder()) {
  const result = sim.dispatch(TRANSFER_ID);
  rec.write(result, snap);
  return { result, rec };
}

function commitReceive(
  sim: TransferEngineSimulator,
  rec: ReturnType<typeof recorder>,
  items = [{ lineId: LINE_1, quantity: 10 }],
  receiveEventId = RECEIVE_ID,
) {
  const result = sim.receive(TRANSFER_ID, receiveEventId, items);
  rec.write(
    result,
    snapshot({
      phase: "receive",
      receiveEventId,
      lines: items.map((item) => ({
        productId: SRC_P1,
        productName: "Soda",
        quantity: item.quantity,
        destinationProductId: DST_P1,
      })),
    }),
  );
  return result;
}

describe("IC-P2-06 inventory transfer audit", () => {
  it("TEST 1 — successful single-product transfer creates exactly one audit event", () => {
    const sim = freshSim();
    const { result, rec } = commitDispatch(sim);
    expect(result).toEqual({ ok: true });
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(90);
    expect(rec.logs).toHaveLength(1);
  });

  it("TEST 2 — audit action/category is inventory_transfer", () => {
    const { rec } = commitDispatch(freshSim());
    expect(rec.logs[0]?.action).toBe("inventory_transfer");
    expect(t("en", "auditAction_inventory_transfer").toLowerCase()).toContain("transfer");
  });

  it("TEST 3 — actor identity is preserved", async () => {
    const { createDefaultPreferences } = await import("../../data/defaultSeed");
    const { setStoreSubscriptionContext } = await import("../storeSubscriptionContext");
    const { usePosStore } = await import("../../store/usePosStore");
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "staff-1", role: "manager", displayName: "Amina" },
      auditLogs: [],
      archivedAuditLogs: [],
      preferences: createDefaultPreferences(),
    });
    const sim = freshSim();
    const result = sim.dispatch(TRANSFER_ID);
    recordInventoryTransferAuditIfSucceeded(result, snapshot(), {
      writeAudit: (action, summary, payload) => usePosStore.getState().logAuditAction(action, summary, payload),
      existingLogs: usePosStore.getState().auditLogs,
    });
    const entry = usePosStore.getState().auditLogs.find((e) => e.action === "inventory_transfer");
    expect(entry?.actorUserId).toBe("staff-1");
    expect(entry?.actorName).toBe("Amina");
    expect(entry?.role).toBe("manager");
  });

  it("TEST 4 — source location is preserved", () => {
    const { rec } = commitDispatch(freshSim());
    expect(rec.logs[0]?.payload.sourceShopId).toBe(SHOP_A);
    expect(rec.logs[0]?.payload.sourceName).toBe("Main Store");
  });

  it("TEST 5 — destination location is preserved", () => {
    const { rec } = commitDispatch(freshSim());
    expect(rec.logs[0]?.payload.destinationShopId).toBe(SHOP_B);
    expect(rec.logs[0]?.payload.destinationName).toBe("Branch 2");
  });

  it("TEST 6 — quantity is preserved", () => {
    const { rec } = commitDispatch(freshSim());
    expect(rec.logs[0]?.payload.totalUnits).toBe(10);
    expect((rec.logs[0]?.payload.lines as Array<{ quantity: number }>)[0]?.quantity).toBe(10);
  });

  it("TEST 7 — product identity is preserved", () => {
    const { rec } = commitDispatch(freshSim());
    expect(rec.logs[0]?.payload.productId).toBe(SRC_P1);
    expect(rec.logs[0]?.payload.productName).toBe("Soda");
    expect(rec.logs[0]?.payload.productIds).toEqual([SRC_P1]);
  });

  it("TEST 8 — multi-line transfer produces one operation-level event", () => {
    const sim = freshSim([
      {
        id: LINE_1,
        sourceProductId: SRC_P1,
        destinationProductId: DST_P1,
        quantity: 10,
        receivedQuantity: 0,
        unitCostUgx: 0,
      },
      {
        id: LINE_2,
        sourceProductId: SRC_P2,
        destinationProductId: DST_P2,
        quantity: 5,
        receivedQuantity: 0,
        unitCostUgx: 0,
      },
    ]);
    const { rec } = commitDispatch(
      sim,
      snapshot({
        lines: [
          { productId: SRC_P1, productName: "Soda", quantity: 10, destinationProductId: DST_P1 },
          { productId: SRC_P2, productName: "Water", quantity: 5, destinationProductId: DST_P2 },
        ],
      }),
    );
    expect(rec.logs).toHaveLength(1);
    expect(rec.logs[0]?.payload.lineCount).toBe(2);
    expect(rec.logs[0]?.payload.totalUnits).toBe(15);
    expect(rec.logs[0]?.payload.productIds).toEqual([SRC_P1, SRC_P2]);
  });

  it("TEST 9 — failed transfer produces no successful-transfer audit event", () => {
    const sim = freshSim([
      {
        id: LINE_1,
        sourceProductId: SRC_P1,
        destinationProductId: DST_P1,
        quantity: 999,
        receivedQuantity: 0,
        unitCostUgx: 0,
      },
    ]);
    const { result, rec } = commitDispatch(
      sim,
      snapshot({ lines: [{ productId: SRC_P1, productName: "Soda", quantity: 999, destinationProductId: DST_P1 }] }),
    );
    expect(result.ok).toBe(false);
    expect(rec.logs).toHaveLength(0);
    expect(sim.products.get(SRC_P1)!.stockOnHand).toBe(100);
  });

  it("TEST 10 — permission-denied transfer produces no audit event", () => {
    const rec = recorder();
    expect(rec.write({ ok: false, error: "forbidden" }, snapshot())).toBe(false);
    expect(shouldWriteInventoryTransferAudit({ ok: false, error: "forbidden" }, snapshot(), [])).toBe(false);
    expect(rec.logs).toHaveLength(0);
  });

  it("TEST 11 — cancelled transfer produces no audit event", () => {
    const sim = freshSim();
    const rec = recorder();
    expect(sim.cancel(TRANSFER_ID)).toEqual({ ok: true });
    expect(sim.transfers.get(TRANSFER_ID)!.status).toBe("cancelled");
    expect(rec.logs).toHaveLength(0);
    const later = commitDispatch(sim, snapshot(), rec);
    expect(later.result.ok).toBe(false);
    expect(later.rec.logs).toHaveLength(0);
  });

  it("TEST 12 — existing shop audit writer/queue path is the persistence authority", () => {
    const sync = src("src/lib/enterprise/stockTransferSync.ts");
    const store = src("src/store/usePosStore.ts");
    expect(sync).toContain("logAuditAction");
    expect(sync).toContain("writeTransferAuditIfSucceeded");
    expect(store).toContain('void queueRemote("audit_log", { entry })');
  });

  it("TEST 13 — existing audit cloud payload can serialize the event", () => {
    const { rec } = commitDispatch(freshSim());
    const prepared = prepareAuditCloudPush(rec.logs[0]!, "auth-user-1");
    expect(() => JSON.stringify(prepared.payload)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(prepared.payload)) as Record<string, unknown>;
    expect(parsed.transferId).toBe(TRANSFER_ID);
    expect(parsed.phase).toBe("dispatch");
    expect(parsed.totalUnits).toBe(10);
    expect(parsed.sourceShopId).toBe(SHOP_A);
    expect(parsed.destinationShopId).toBe(SHOP_B);
  });

  it("TEST 14 — Investigation Center search/index discovers the event", () => {
    const { rec } = commitDispatch(freshSim());
    const index = buildAuditLogSearchIndex(rec.logs, { lang: "en" });
    const matches = collectInvestigationMatches(index, { searchText: "soda" }, {
      category: "all",
      activeKpi: null,
      todayKey: "2026-09-06",
    });
    expect(matches).toHaveLength(1);
    expect(collectInvestigationMatches(index, { searchText: "branch 2" }, {
      category: "all",
      activeKpi: null,
      todayKey: "2026-09-06",
    })).toHaveLength(1);
  });

  it("TEST 15 — Investigation Center inventory filter includes the event", () => {
    const { rec } = commitDispatch(freshSim());
    const index = buildAuditLogSearchIndex(rec.logs);
    expect(collectInvestigationMatches(index, {}, {
      category: "inventory",
      activeKpi: "inventory",
      todayKey: "2026-09-06",
    })).toHaveLength(1);
    expect(collectInvestigationMatches(index, {}, {
      category: "sales",
      activeKpi: null,
      todayKey: "2026-09-06",
    })).toHaveLength(0);
  });

  it("TEST 16 — export receives the event through the normal audit match set", () => {
    const { rec } = commitDispatch(freshSim());
    const matching = collectInvestigationMatches(buildAuditLogSearchIndex(rec.logs), {}, {
      category: "all",
      activeKpi: null,
      todayKey: "2026-09-06",
    });
    const rows = auditEntriesToExportRows("en", matching);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(rec.logs[0]?.id);
    expect(rows[0]?.action.toLowerCase()).toContain("transfer");
    expect(investigationShareSlice(matching, 40)[0]?.id).toBe(rec.logs[0]?.id);
  });

  it("TEST 17 — existing audit active-cap/archive remains compatible", () => {
    const { rec } = commitDispatch(freshSim());
    const filler: AuditLogEntry[] = Array.from({ length: 4 }, (_, i) => ({
      id: `old-${i}`,
      at: `2026-01-0${i + 1}T00:00:00.000Z`,
      actorUserId: "staff-1",
      role: "cashier",
      action: "sale_completed",
      payloadSummary: "sale",
      payload: {},
    }));
    const merged = applyAuditActiveCap([rec.logs[0]!, ...filler], [], 3);
    expect(merged.auditLogs.length + merged.archivedAuditLogs.length).toBe(5);
    expect([...merged.auditLogs, ...merged.archivedAuditLogs].some((e) => e.id === rec.logs[0]?.id)).toBe(true);
  });

  it("TEST 18 — repeated sync/replay does not duplicate the event", () => {
    const sim = freshSim();
    const rec = recorder();
    expect(commitDispatch(sim, snapshot(), rec).result.ok).toBe(true);
    const replay = sim.dispatch(TRANSFER_ID);
    rec.write(replay, snapshot());
    rec.write({ ok: true, idempotent: true }, snapshot());
    expect(replay).toMatchObject({ ok: true, idempotent: true });
    expect(rec.logs).toHaveLength(1);
    expect(rec.logs[0]?.payload.correlationId).toBe(inventoryTransferCorrelationId(snapshot()));
  });

  it("TEST 19 — existing audit events remain unchanged", () => {
    const stockAdjust: AuditLogEntry = {
      id: "adj-1",
      at: "2026-09-06T09:00:00.000Z",
      actorUserId: "staff-1",
      role: "manager",
      action: "stock_adjust",
      payloadSummary: "count +1 · Soda",
      payload: { productId: SRC_P1, delta: 1, reason: "count" },
    };
    const rec = recorder([stockAdjust]);
    rec.write({ ok: true }, snapshot());
    expect(rec.logs.filter((e) => e.action === "stock_adjust")).toHaveLength(1);
    expect(rec.logs.filter((e) => e.action === "inventory_transfer")).toHaveLength(1);
    expect(rec.logs.find((e) => e.action === "stock_adjust")?.payload.delta).toBe(1);
  });

  it("TEST 20 — existing transfer behavior remains unchanged", () => {
    const control = freshSim();
    const audited = freshSim();
    const controlResult = control.dispatch(TRANSFER_ID);
    const auditedResult = commitDispatch(audited).result;
    expect(auditedResult).toEqual(controlResult);
    expect(audited.products.get(SRC_P1)!.stockOnHand).toBe(control.products.get(SRC_P1)!.stockOnHand);
    expect(audited.transfers.get(TRANSFER_ID)!.status).toBe(control.transfers.get(TRANSFER_ID)!.status);
  });

  it("receive success writes a separate receive event with receiveEventId correlation", () => {
    const sim = freshSim();
    const rec = recorder();
    commitDispatch(sim, snapshot(), rec);
    commitReceive(sim, rec);
    expect(rec.logs).toHaveLength(2);
    expect(rec.logs.map((e) => e.payload.phase).sort()).toEqual(["dispatch", "receive"]);
    expect(rec.logs.find((e) => e.payload.phase === "receive")?.payload.receiveEventId).toBe(RECEIVE_ID);
  });

  it("narrative and label stay localized and truthful", () => {
    const { rec } = commitDispatch(freshSim());
    const line = describeAuditLine("en", rec.logs[0]!, new Map(), new Map());
    expect(line.toLowerCase()).toContain("soda");
    expect(line).toContain("Main Store");
    expect(line).toContain("Branch 2");
    expect(t("lg", "auditAction_inventory_transfer")).toContain("sitoka");
  });

  it("payload builder is bounded and JSON-serializable", () => {
    const payload = buildInventoryTransferAuditPayload(
      snapshot({
        lines: Array.from({ length: 30 }, (_, i) => ({
          productId: `p-${i}`,
          productName: `Item ${i}`,
          quantity: 1,
        })),
      }),
    );
    expect(payload.lineCount).toBe(30);
    expect(payload.truncated).toBe(true);
    expect((payload.lines as unknown[]).length).toBe(24);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it("cloud/queue success boundary records only after RPC ok", () => {
    const sync = src("src/lib/enterprise/stockTransferSync.ts");
    const page = src("src/pages/InventoryTransferPage.tsx");
    const cloud = src("src/offline/cloudSync.ts");
    const dispatchIdx = sync.indexOf("export async function dispatchTransferCloud");
    const receiveIdx = sync.indexOf("export async function receiveTransferCloud");
    expect(sync.indexOf("writeTransferAuditIfSucceeded", dispatchIdx)).toBeGreaterThan(sync.indexOf("if (!j.ok)", dispatchIdx));
    expect(sync.indexOf("writeTransferAuditIfSucceeded", receiveIdx)).toBeGreaterThan(sync.indexOf("if (!j.ok)", receiveIdx));
    expect(page).toContain("dispatchTransferCloud(draftTransferId, snapshot)");
    expect(page).toContain("queueTransferDispatch(draftTransferId, activeShopId, snapshot)");
    expect(cloud).toContain("parseInventoryTransferAuditSnapshot(payload.auditSnapshot)");
  });
});

function src(rel: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../..", rel), "utf8");
}
