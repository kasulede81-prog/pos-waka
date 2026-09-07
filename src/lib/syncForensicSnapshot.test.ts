import { describe, expect, it } from "vitest";
import type { DayCloseSummary, SyncOperation } from "../types";
import { computeSyncBackoffMs } from "./autoSync";
import {
  buildSyncForensicSnapshot,
  classifySyncForensicPayload,
  formatSyncForensicExport,
  type SyncForensicBuildInput,
} from "./syncForensicSnapshot";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-09-07T12:00:00.000Z");

function dayClose(dateKey: string): DayCloseSummary {
  return {
    id: `close-${dateKey}`,
    dateKey,
    expectedCashUgx: 0,
    countedCashUgx: 0,
    differenceUgx: 0,
    totalSalesUgx: 0,
    totalDebtUgx: 0,
    profitEstimateUgx: 0,
    createdAt: `${dateKey}T20:00:00.000Z`,
  };
}

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, "id">): SyncOperation {
  return {
    kind: "pending_sales",
    payload: { saleId: partial.id },
    createdAt: "2026-09-07T10:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    shopId: SHOP_A,
    ...partial,
  };
}

function snapshot(
  queue: SyncOperation[],
  extra: Partial<SyncForensicBuildInput> = {},
) {
  return buildSyncForensicSnapshot({
    queue,
    nowMs: NOW,
    dayCloses: [],
    activeShopId: SHOP_A,
    accountKeyPresent: true,
    authenticated: true,
    actorRole: "owner",
    online: true,
    platform: "web",
    runtime: "desktop",
    appVersion: "1.0.12",
    ...extra,
  });
}

describe("buildSyncForensicSnapshot", () => {
  it("1. empty queue", () => {
    const snap = snapshot([]);
    expect(snap.queue.total).toBe(0);
    expect(snap.queue.queueHealth).toBe("healthy");
    expect(snap.queue.queueHasReadyWork).toBe(false);
    expect(snap.queue.queueHasBackoff).toBe(false);
    expect(snap.blocker).toBeNull();
    expect(snap.rows).toEqual([]);
    expect(snap.starvation.firstPriorityRowId).toBeNull();
  });

  it("2. ready operation", () => {
    const row = op({ id: "ready-1" });
    const snap = snapshot([row]);
    expect(snap.rows[0]?.classification).toBe("READY");
    expect(snap.rows[0]?.retryEligible).toBe(true);
    expect(snap.queue.queueHasReadyWork).toBe(true);
    expect(snap.queue.queueHasBackoff).toBe(false);
    expect(snap.queue.queueHealth).toBe("healthy");
    expect(snap.blocker).toBeNull();
  });

  it("3. normal backoff", () => {
    const nowMs = Date.now();
    const lastAttemptAt = new Date(nowMs - 1_000).toISOString();
    const row = op({
      id: "backoff-1",
      attempts: 2,
      lastAttemptAt,
      lastError: "network",
    });
    const snap = snapshot([row], { nowMs });
    expect(snap.rows[0]?.classification).toBe("BACKOFF");
    expect(snap.rows[0]?.retryEligible).toBe(false);
    expect(snap.rows[0]?.retryAt).toBe(
      new Date(Date.parse(lastAttemptAt) + computeSyncBackoffMs(2)).toISOString(),
    );
    expect(snap.queue.queueHasBackoff).toBe(true);
    expect(snap.queue.queueHasClosedDatePark).toBe(false);
    expect(snap.queue.queueHealth).toBe("backing_off");
    expect(snap.blocker?.id).toBe("backoff-1");
    expect(snap.blocker?.classification).toBe("BACKOFF");
  });

  it("4. closed-date parked operation", () => {
    const row = op({
      id: "park-1",
      attempts: 1,
      lastAttemptAt: "2026-09-07T11:00:00.000Z",
      lastError: "closed_business_date",
      closedDateKey: "2026-09-01",
    });
    const snap = snapshot([row], { dayCloses: [dayClose("2026-09-01")] });
    expect(snap.rows[0]?.classification).toBe("CLOSED_DATE_PARK");
    expect(snap.rows[0]?.retryEligible).toBe(false);
    expect(snap.queue.queueHasClosedDatePark).toBe(true);
    expect(snap.queue.queueHasBackoff).toBe(false);
    expect(snap.blocker?.classification).toBe("CLOSED_DATE_PARK");
    expect(snap.blocker?.closedDateKey).toBe("2026-09-01");
  });

  it("does not label reopened closed-date backoff as park", () => {
    const row = op({
      id: "reopened-1",
      attempts: 3,
      lastAttemptAt: "2026-09-07T11:59:59.000Z",
      lastError: "closed_business_date",
      closedDateKey: "2026-09-01",
    });
    const snap = snapshot([row], { dayCloses: [] });
    expect(snap.rows[0]?.classification).toBe("BACKOFF");
    expect(snap.queue.queueHasClosedDatePark).toBe(false);
  });

  it("5. shop mismatch", () => {
    const row = op({ id: "mismatch-1", shopId: SHOP_B });
    const snap = snapshot([row]);
    expect(snap.rows[0]?.classification).toBe("SHOP_MISMATCH");
    expect(snap.rows[0]?.shopIdPresent).toBe(true);
    expect(snap.rows[0]?.shopMatchesActive).toBe(false);
    expect(snap.queue.queueHasShopMismatch).toBe(true);
  });

  it("6. missing shop", () => {
    const row = op({ id: "noshop-1", shopId: undefined });
    delete (row as { shopId?: string }).shopId;
    const snap = snapshot([row]);
    expect(snap.rows[0]?.classification).toBe("MISSING_SHOP");
    expect(snap.rows[0]?.shopIdPresent).toBe(false);
    expect(snap.queue.queueHasMissingShop).toBe(true);
  });

  it("7. malformed row", () => {
    const row = op({ id: "   ", createdAt: "", attempts: Number.NaN });
    const snap = snapshot([row]);
    expect(snap.rows[0]?.classification).toBe("MALFORMED");
    expect(snap.queue.queueHasMalformedRows).toBe(true);
  });

  it("8. unknown kind", () => {
    const row = op({ id: "unk-1", kind: "pending_magic" as SyncOperation["kind"] });
    const snap = snapshot([row]);
    expect(snap.rows[0]?.classification).toBe("UNKNOWN_KIND");
    expect(snap.queue.queueHasUnknownKind).toBe(true);
  });

  it("9. multiple rows keep READY + BACKOFF flags together", () => {
    const nowMs = Date.now();
    const ready = op({ id: "ready-2", createdAt: "2026-09-07T11:00:00.000Z" });
    const backoff = op({
      id: "backoff-2",
      createdAt: "2026-09-07T10:00:00.000Z",
      attempts: 4,
      lastAttemptAt: new Date(nowMs - 1_000).toISOString(),
      lastError: "timeout",
    });
    const snap = snapshot([ready, backoff], { nowMs });
    expect(snap.queue.queueHasReadyWork).toBe(true);
    expect(snap.queue.queueHasBackoff).toBe(true);
    expect(snap.queue.queueHealth).toBe("backing_off");
    expect(snap.queue.total).toBe(2);
    expect(snap.starvation.oldestQueueRowId).toBe("backoff-2");
    expect(snap.starvation.firstPriorityRowId).toBe("backoff-2");
    expect(snap.starvation.firstRetryEligibleRowId).toBe("ready-2");
    expect(snap.starvation.firstNonRetryEligibleRowId).toBe("backoff-2");
  });

  it("10. top blocker ordering prefers park, then ineligible, then attempts, then oldest", () => {
    const nowMs = Date.now();
    const lastAttemptAt = new Date(nowMs - 500).toISOString();
    const ready = op({ id: "ready-3", createdAt: "2026-09-07T08:00:00.000Z", attempts: 9 });
    const backoffOld = op({
      id: "backoff-old",
      createdAt: "2026-09-07T09:00:00.000Z",
      attempts: 2,
      lastAttemptAt,
    });
    const backoffHot = op({
      id: "backoff-hot",
      createdAt: "2026-09-07T09:30:00.000Z",
      attempts: 6,
      lastAttemptAt,
    });
    const park = op({
      id: "park-top",
      createdAt: "2026-09-07T12:00:00.000Z",
      attempts: 1,
      lastAttemptAt: "2026-09-07T11:00:00.000Z",
      lastError: "closed_business_date",
      closedDateKey: "2026-09-01",
    });
    const snap = snapshot([ready, backoffOld, backoffHot, park], {
      nowMs,
      dayCloses: [dayClose("2026-09-01")],
    });
    expect(snap.blockingRows.map((r) => r.id)).toEqual([
      "park-top",
      "backoff-hot",
      "backoff-old",
      "ready-3",
    ]);
    expect(snap.blocker?.id).toBe("park-top");
    expect(snap.blocker?.classification).toBe("CLOSED_DATE_PARK");
  });

  it("11. sensitive payload redaction", () => {
    const row = op({
      id: "pii-1",
      kind: "customer",
      payload: {
        id: "cust-1",
        name: "Aisha Nakato",
        phone: "+256700000000",
        email: "owner@example.com",
        token: "jwt-secret-value",
        password: "hunter2",
        cardNumber: "4111111111111111",
      },
    });
    const snap = snapshot([row]);
    expect(snap.rows[0]?.payloadClass).toBe("customer");
    const exported = formatSyncForensicExport(snap);
    expect(exported).not.toContain("Aisha Nakato");
    expect(exported).not.toContain("+256700000000");
    expect(exported).not.toContain("owner@example.com");
    expect(exported).not.toContain("jwt-secret-value");
    expect(exported).not.toContain("hunter2");
    expect(exported).not.toContain("4111111111111111");
    expect(exported).not.toContain("sb:");
    expect(exported).toContain("pii-1");
    expect(exported).toContain("customer");
  });

  it("does not mutate the input queue", () => {
    const row = op({
      id: "immutable-1",
      attempts: 3,
      lastAttemptAt: "2026-09-07T11:00:00.000Z",
      payload: { saleId: "sale-1", customerName: "secret" },
    });
    const before = structuredClone(row);
    snapshot([row]);
    expect(row).toEqual(before);
  });

  it("classifies sale/return/void payload kinds without exposing payload", () => {
    expect(classifySyncForensicPayload("pending_sales", { customerName: "x" })).toBe("sale");
    expect(classifySyncForensicPayload("pending_returns", { saleId: "s1" })).toBe("return");
    expect(classifySyncForensicPayload("pending_sales", { kind: "sale_void" })).toBe("void");
  });

  it("classifies missing session separately from ready work", () => {
    const row = op({ id: "session-1" });
    const snap = snapshot([row], { authenticated: false });
    expect(snap.rows[0]?.classification).toBe("MISSING_SESSION");
    expect(snap.blocker?.classification).toBe("MISSING_SESSION");
  });

  it("does not expose raw account namespace", () => {
    const snap = snapshot([op({ id: "ns-1" })], { accountKeyPresent: true });
    const exported = formatSyncForensicExport(snap);
    expect(snap.auth.accountNamespacePresent).toBe(true);
    expect(exported).toContain('"accountKeyPresent": true');
    expect(exported).not.toMatch(/sb:[a-z0-9-]+/i);
  });
});

