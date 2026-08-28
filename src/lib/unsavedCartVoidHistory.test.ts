import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { t } from "./i18n";
import { partitionReceiptsSales } from "./receiptsGrouping";
import {
  isCancelledPendingSale,
  isPreCompletionVoidedSale,
  isRevenueSale,
  UNSAVED_CART_VOID_REASON,
  voidedSaleHistoryNumber,
} from "./saleStatus";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const AT = "2026-08-28T15:42:00.000Z";
const VOID_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function line(name: string, qty: number, total: number): SaleLine {
  return {
    id: `line-${name}`,
    productId: `prod-${name}`,
    name,
    inputMode: "quantity",
    quantity: qty,
    unitPriceUgx: total / qty,
    unitCostUgx: 1_000,
    lineTotalUgx: total,
    estimatedProfitUgx: total - 1_000 * qty,
    updatedAt: AT,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "status">): Sale {
  return {
    createdAt: AT,
    updatedAt: AT,
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 0,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    lines: [line("Item", 1, 10_000)],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("unsaved-cart VOIDED history partition", () => {
  it("places pre-completion voids in voided, not completed or cancelled", () => {
    const voided = sale({
      id: VOID_ID,
      status: "cancelled",
      saleVoidedAt: AT,
      saleVoidReason: UNSAVED_CART_VOID_REASON,
      saleVoidedByLabel: "Sarah",
      totalUgx: 125_000,
      lines: [line("Coca-Cola", 2, 100_000), line("Bread", 1, 25_000)],
    });
    const completed = sale({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "completed", cashPaidUgx: 10_000 });
    const pending = sale({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "pending" });
    const cancelledPending = sale({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", status: "cancelled" });
    const partitioned = partitionReceiptsSales([voided, completed, pending, cancelledPending]);
    expect(partitioned.voided.map((s) => s.id)).toEqual([VOID_ID]);
    expect(partitioned.completed.map((s) => s.id)).toEqual([completed.id]);
    expect(partitioned.pending.map((s) => s.id)).toEqual([pending.id]);
    expect(partitioned.cancelled.map((s) => s.id)).toEqual([cancelledPending.id]);
    expect(isPreCompletionVoidedSale(voided)).toBe(true);
    expect(isCancelledPendingSale(cancelledPending)).toBe(true);
    expect(isRevenueSale(voided)).toBe(false);
    expect(voidedSaleHistoryNumber(voided)).toBe("VOID-AAAAAAAA");
    expect(t("en", "salesHistoryStatusVoided")).toBe("VOIDED");
    expect(t("en", "salesHistoryVoidedBeforeCompletion")).toMatch(/voided before completion/);
  });
});

describe("unsaved-cart VOIDED Sales History + sync wiring", () => {
  it("lists VOIDED in the main Sales History, not behind Show cancelled", () => {
    const page = src("src/pages/ReceiptsPage.tsx");
    expect(page).toContain("partitioned.voided");
    expect(page).toContain("voidedSaleHistoryNumber");
    expect(page).not.toMatch(/primary = \[\.\.\.partitioned\.completed, \.\.\.partitioned\.pending\]/);
  });

  it("row and desktop table render VOIDED and hide completed-receipt actions", () => {
    const row = src("src/components/receipts/SalesHistoryRow.tsx");
    expect(row).toContain("salesHistoryStatusVoided");
    expect(row).toContain("salesHistoryVoidedBeforeCompletion");
    expect(row).toContain("salesHistoryVoidedBy");
    expect(row).toContain("voidedBeforeComplete");
    const table = src("src/components/receipts/SalesHistoryDesktopTable.tsx");
    expect(table).toContain("salesHistoryStatusVoided");
    expect(table).toContain("isPreCompletionVoidedSale");
  });

  it("cart void snapshots before clearing and never completes EFRIS or reverses stock", () => {
    const store = src("src/store/usePosStore.ts");
    const start = store.lastIndexOf("voidCurrentCart: () => {");
    const end = store.indexOf("ensureHospitalityFloor:", start);
    const fn = store.slice(start, end);
    expect(fn.indexOf("buildUnsavedCartVoidedSale")).toBeGreaterThan(0);
    expect(fn.indexOf("buildUnsavedCartVoidedSale")).toBeLessThan(fn.indexOf("emptyDraftPatch"));
    expect(fn.indexOf("clearPersistedDraft")).toBeGreaterThan(fn.indexOf("unsavedCartVoidPersistSucceeded"));
    expect(fn).toContain("unsavedCartVoidPersistSucceeded");
    expect(fn).not.toContain("voidSaleLine");
    expect(fn).not.toContain("enqueueEfrisAfterCompletedSale");
    expect(fn).not.toContain("shop_push_sale_complete");
    expect(fn).toContain('kind: "pending_cancel"');
  });

  it("cloud cancel of a never-saved VOIDED sale may upsert draft then cancel, never complete", () => {
    const sync = src("src/offline/cloudSync.ts");
    expect(sync).toContain("pushUnsavedCartVoidToCloud");
    expect(sync).toContain("pendingCloneForUnsavedCartVoidUpload");
    expect(sync).toContain("shouldUpsertDraftBeforeCancel");
    const helperStart = sync.indexOf("export async function pushUnsavedCartVoidToCloud");
    const helperEnd = sync.indexOf("export async function pushSaleRowToCloud", helperStart);
    const helper = sync.slice(helperStart, helperEnd);
    expect(helper).toContain("pushPendingSaleToCloud");
    expect(helper).toContain("pushCancelPendingSaleToCloud");
    expect(helper).not.toContain("shop_push_sale_complete");
    expect(helper).not.toContain("pushSaleToCloud");
  });
});
