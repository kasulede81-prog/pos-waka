/**
 * SALES-SYNC-HISTORICAL-SALE-REPAIR-09
 *
 * One-shot authenticated repair for a single proven historical sale header.
 * Not a migration. Not a bulk script. Does not call shop_push_sale_return.
 */

import { originalSaleTotalUgx } from "./returnLimits";
import { hasSupabaseConfig, supabase } from "./supabase";
import { idSuffix } from "./blockedReturnRecovery";
import type { ReturnRecord, Sale } from "../types";

export const HISTORICAL_REPAIR_SALE_ID = "3dbdd270-8138-477e-935c-90f11a2dc3c3";
export const HISTORICAL_REPAIR_SHOP_ID = "1a110d2e-d957-4c6e-a936-8af86403a836";
export const HISTORICAL_REPAIR_RETURN_ID = "2fb42c22-25b6-4771-8bb9-c8bd00e937e2";
export const HISTORICAL_REPAIR_PRODUCT_ID = "1f35d2bf-b64d-4078-abb8-9cc4cd3277db";
export const HISTORICAL_REPAIR_QUEUE_ID = "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf";

const ORIGINAL_TOTAL_UGX = 1000;
const ORIGINAL_CASH_UGX = 1000;
const ORIGINAL_DEBT_UGX = 0;
const ORIGINAL_QTY = 1;
const RETURN_QTY = 1;
const RETURN_REFUND_UGX = 1000;
const RETURN_REASON = "warm_bad";

const AUDIT_KEY = "waka.historicalSaleRepair.audit.v1";
const CSV_KEY = "waka.historicalSaleRepair.csv.v1";

export type HistoricalRepairStatus =
  | "skipped"
  | "assert_failed"
  | "permission_denied"
  | "write_failed"
  | "verify_failed"
  | "repaired"
  | "already_repaired";

export type HistoricalRepairOutcome = {
  status: HistoricalRepairStatus;
  reason?: string;
  wrote: boolean;
  allowReturnRecovery: boolean;
  assertions?: string[];
  after?: {
    totalUgx: number;
    cashAmountUgx: number;
    debtAmountUgx: number;
    subtotalUgx: number;
    lineCount: number;
    lineQty: number;
    lineUnit: number;
    lineTotal: number;
    returnCount: number;
  };
};

let attempted = false;
let lastOutcome: HistoricalRepairOutcome | null = null;

export function resetHistoricalSaleHeaderRepairForTests(): void {
  attempted = false;
  lastOutcome = null;
}

export function readHistoricalSaleHeaderRepairOutcome(): HistoricalRepairOutcome | null {
  return lastOutcome;
}

export function localOriginalCashUgx(sale: Pick<Sale, "cashPaidUgx" | "debtUgx" | "voidedTotalUgx">): number {
  if (Math.floor(Number(sale.debtUgx) || 0) !== 0) return Number.NaN;
  return Math.max(0, Math.floor(Number(sale.cashPaidUgx) || 0)) + Math.max(0, Math.floor(Number(sale.voidedTotalUgx) || 0));
}

export function assertLocalOriginalHeader(
  sale: Sale,
  returns: ReturnRecord[],
): { ok: true } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  const originalTotal = originalSaleTotalUgx(sale, returns);
  const originalCash = localOriginalCashUgx(sale);
  const debt = Math.floor(Number(sale.debtUgx) || 0);
  if (originalTotal !== ORIGINAL_TOTAL_UGX) failures.push(`local_original_total_${originalTotal}`);
  if (originalCash !== ORIGINAL_CASH_UGX) failures.push(`local_original_cash_${originalCash}`);
  if (debt !== ORIGINAL_DEBT_UGX) failures.push(`local_debt_${debt}`);
  return failures.length ? { ok: false, failures } : { ok: true };
}

function persistOutcome(outcome: HistoricalRepairOutcome): HistoricalRepairOutcome {
  lastOutcome = outcome;
  const after = outcome.after;
  const csv = [
    "HSR1",
    outcome.status,
    outcome.wrote ? "1" : "0",
    outcome.allowReturnRecovery ? "1" : "0",
    outcome.reason ?? "",
    String(after?.totalUgx ?? ""),
    String(after?.cashAmountUgx ?? ""),
    String(after?.debtAmountUgx ?? ""),
    String(after?.subtotalUgx ?? ""),
    String(after?.lineCount ?? ""),
    String(after?.lineQty ?? ""),
    String(after?.lineUnit ?? ""),
    String(after?.lineTotal ?? ""),
    String(after?.returnCount ?? ""),
    new Date().toISOString(),
  ].join(",");
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CSV_KEY, csv);
    }
  } catch {
    /* quota */
  }
  return outcome;
}

function persistAudit(phase: "pre_write" | "skipped" | "failed", extra?: Record<string, string | number | boolean>): void {
  const record = {
    type: "historical_sale_header_sync_repair",
    saleIdSuffix: idSuffix(HISTORICAL_REPAIR_SALE_ID),
    shopIdSuffix: idSuffix(HISTORICAL_REPAIR_SHOP_ID),
    old: { total: 0, cash: 0 },
    new: { total: ORIGINAL_TOTAL_UGX, cash: ORIGINAL_CASH_UGX },
    reason: "pre-cloud-completion Return reduced live sale header before first cloud sale completion",
    phase,
    at: new Date().toISOString(),
    ...extra,
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(record));
    }
  } catch {
    /* quota */
  }
}

function clientCanQuery(): boolean {
  return Boolean(hasSupabaseConfig && supabase && typeof supabase.from === "function");
}

async function loadLocalSale(): Promise<Sale | null> {
  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const ram = [...state.sales, ...(state.archivedSales ?? [])].find((s) => s.id === HISTORICAL_REPAIR_SALE_ID);
  if (ram) return ram;
  const { getEntitiesByIds } = await import("../offline/entityStore");
  const [fromDisk] = await getEntitiesByIds<Sale>("sale", [HISTORICAL_REPAIR_SALE_ID]);
  if (fromDisk) return fromDisk;
  const [fromArchive] = await getEntitiesByIds<Sale>("archivedSale", [HISTORICAL_REPAIR_SALE_ID]);
  return fromArchive ?? null;
}

async function loadLocalReturn(): Promise<ReturnRecord | null> {
  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const ram = [...state.returnRecords, ...(state.archivedReturnRecords ?? [])].find(
    (row) => row.id === HISTORICAL_REPAIR_RETURN_ID,
  );
  if (ram) return ram;
  const { getEntitiesByIds } = await import("../offline/entityStore");
  const [fromDisk] = await getEntitiesByIds<ReturnRecord>("returnRecord", [HISTORICAL_REPAIR_RETURN_ID]);
  if (fromDisk) return fromDisk;
  const [fromArchive] = await getEntitiesByIds<ReturnRecord>("archivedReturnRecord", [HISTORICAL_REPAIR_RETURN_ID]);
  return fromArchive ?? null;
}

type CloudSnapshot = {
  totalUgx: number;
  cashAmountUgx: number;
  debtAmountUgx: number;
  subtotalUgx: number;
  discountUgx: number;
  shopId: string;
  lines: Array<{ productId: string; quantity: number; unitPriceUgx: number; lineTotalUgx: number }>;
  returnIds: string[];
  returns: Array<{
    id: string;
    quantity: number;
    refundAmountUgx: number;
    reason: string | null;
    productId: string;
    saleId: string;
  }>;
};

async function readCloudSnapshot(): Promise<{ ok: true; data: CloudSnapshot } | { ok: false; reason: string }> {
  if (!supabase) return { ok: false, reason: "no_supabase" };
  const saleRes = await supabase
    .from("sales")
    .select("id, shop_id, total_ugx, cash_amount_ugx, debt_amount_ugx, subtotal_ugx, discount_ugx")
    .eq("id", HISTORICAL_REPAIR_SALE_ID)
    .eq("shop_id", HISTORICAL_REPAIR_SHOP_ID)
    .maybeSingle();
  if (saleRes.error) return { ok: false, reason: `select_sale_${saleRes.error.code ?? "error"}` };
  if (!saleRes.data) return { ok: false, reason: "sale_missing" };

  const lineRes = await supabase
    .from("sale_line_items")
    .select("product_id, quantity, unit_price_ugx, line_total_ugx")
    .eq("sale_id", HISTORICAL_REPAIR_SALE_ID);
  if (lineRes.error) return { ok: false, reason: `select_lines_${lineRes.error.code ?? "error"}` };

  const retRes = await supabase
    .from("sale_returns")
    .select("id, quantity, refund_amount_ugx, reason, product_id, sale_id")
    .eq("sale_id", HISTORICAL_REPAIR_SALE_ID);
  if (retRes.error) return { ok: false, reason: `select_returns_${retRes.error.code ?? "error"}` };

  return {
    ok: true,
    data: {
      totalUgx: Number(saleRes.data.total_ugx ?? 0),
      cashAmountUgx: Number(saleRes.data.cash_amount_ugx ?? 0),
      debtAmountUgx: Number(saleRes.data.debt_amount_ugx ?? 0),
      subtotalUgx: Number(saleRes.data.subtotal_ugx ?? 0),
      discountUgx: Number(saleRes.data.discount_ugx ?? 0),
      shopId: String(saleRes.data.shop_id ?? ""),
      lines: (lineRes.data ?? []).map((line) => ({
        productId: String(line.product_id ?? ""),
        quantity: Number(line.quantity ?? 0),
        unitPriceUgx: Number(line.unit_price_ugx ?? 0),
        lineTotalUgx: Number(line.line_total_ugx ?? 0),
      })),
      returnIds: (retRes.data ?? []).map((row) => String(row.id ?? "")),
      returns: (retRes.data ?? []).map((row) => ({
        id: String(row.id ?? ""),
        quantity: Number(row.quantity ?? 0),
        refundAmountUgx: Number(row.refund_amount_ugx ?? 0),
        reason: row.reason != null ? String(row.reason) : null,
        productId: String(row.product_id ?? ""),
        saleId: String(row.sale_id ?? ""),
      })),
    },
  };
}

function assertPreWrite(input: {
  activeShopId: string | null;
  sale: Sale;
  ret: ReturnRecord;
  returns: ReturnRecord[];
  cloud: CloudSnapshot;
}): { ok: true } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  if (input.activeShopId !== HISTORICAL_REPAIR_SHOP_ID) failures.push("active_shop_mismatch");
  if (input.cloud.shopId !== HISTORICAL_REPAIR_SHOP_ID) failures.push("cloud_shop_mismatch");
  if (input.cloud.totalUgx !== 0) failures.push(`cloud_total_${input.cloud.totalUgx}`);
  if (input.cloud.cashAmountUgx !== 0) failures.push(`cloud_cash_${input.cloud.cashAmountUgx}`);
  if (input.cloud.debtAmountUgx !== ORIGINAL_DEBT_UGX) failures.push(`cloud_debt_${input.cloud.debtAmountUgx}`);
  if (input.cloud.subtotalUgx !== ORIGINAL_TOTAL_UGX) failures.push(`cloud_subtotal_${input.cloud.subtotalUgx}`);
  if (input.cloud.discountUgx !== 0) failures.push(`cloud_discount_${input.cloud.discountUgx}`);
  if (input.cloud.lines.length !== 1) failures.push(`cloud_line_count_${input.cloud.lines.length}`);
  const line = input.cloud.lines[0];
  if (!line || line.productId !== HISTORICAL_REPAIR_PRODUCT_ID) failures.push("cloud_line_product");
  if (!line || line.quantity !== ORIGINAL_QTY) failures.push(`cloud_line_qty_${line?.quantity}`);
  if (!line || line.unitPriceUgx !== ORIGINAL_TOTAL_UGX) failures.push(`cloud_line_unit_${line?.unitPriceUgx}`);
  if (!line || line.lineTotalUgx !== ORIGINAL_TOTAL_UGX) failures.push(`cloud_line_total_${line?.lineTotalUgx}`);
  if (input.cloud.returnIds.includes(HISTORICAL_REPAIR_RETURN_ID)) failures.push("cloud_return_already_present");
  if (input.ret.saleId !== HISTORICAL_REPAIR_SALE_ID) failures.push("local_return_sale");
  if (input.ret.quantity !== RETURN_QTY) failures.push(`local_return_qty_${input.ret.quantity}`);
  if (Math.floor(input.ret.refundAmountUgx) !== RETURN_REFUND_UGX) failures.push(`local_return_refund_${input.ret.refundAmountUgx}`);
  if (input.ret.reason !== RETURN_REASON) failures.push(`local_return_reason_${input.ret.reason}`);
  const localHeader = assertLocalOriginalHeader(input.sale, input.returns);
  if (!localHeader.ok) failures.push(...localHeader.failures);
  return failures.length ? { ok: false, failures } : { ok: true };
}

function persistFacts(cloud: CloudSnapshot, extra: { wrote: boolean; status: string; queuePresent?: boolean }): void {
  const line = cloud.lines[0];
  const ret = cloud.returns.find((row) => row.id === HISTORICAL_REPAIR_RETURN_ID) ?? cloud.returns[0];
  const facts = [
    "HSRV",
    `T${cloud.totalUgx}`,
    `C${cloud.cashAmountUgx}`,
    `D${cloud.debtAmountUgx}`,
    `S${cloud.subtotalUgx}`,
    `LN${cloud.lines.length}`,
    `LQ${line?.quantity ?? "x"}`,
    `LU${line?.unitPriceUgx ?? "x"}`,
    `LT${line?.lineTotalUgx ?? "x"}`,
    `RN${cloud.returns.length}`,
    `RID${ret ? (ret.id.endsWith("e937e2") ? "37e2" : "other") : "none"}`,
    `RQ${ret?.quantity ?? "x"}`,
    `RA${ret?.refundAmountUgx ?? "x"}`,
    `RW${ret?.reason ?? "x"}`,
    `QP${extra.queuePresent == null ? "x" : extra.queuePresent ? "1" : "0"}`,
    extra.status,
    extra.wrote ? "W1" : "W0",
  ].join("|");
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("waka.hsrv.v1", facts);
    }
  } catch {
    /* quota */
  }
}

function cloudHeaderRepaired(cloud: CloudSnapshot): boolean {
  const line = cloud.lines[0];
  return (
    cloud.totalUgx === ORIGINAL_TOTAL_UGX &&
    cloud.cashAmountUgx === ORIGINAL_CASH_UGX &&
    cloud.debtAmountUgx === ORIGINAL_DEBT_UGX &&
    cloud.subtotalUgx === ORIGINAL_TOTAL_UGX &&
    cloud.lines.length === 1 &&
    line?.productId === HISTORICAL_REPAIR_PRODUCT_ID &&
    line.quantity === ORIGINAL_QTY &&
    line.unitPriceUgx === ORIGINAL_TOTAL_UGX &&
    line.lineTotalUgx === ORIGINAL_TOTAL_UGX
  );
}

function snapshotAfter(cloud: CloudSnapshot): HistoricalRepairOutcome["after"] {
  const line = cloud.lines[0];
  return {
    totalUgx: cloud.totalUgx,
    cashAmountUgx: cloud.cashAmountUgx,
    debtAmountUgx: cloud.debtAmountUgx,
    subtotalUgx: cloud.subtotalUgx,
    lineCount: cloud.lines.length,
    lineQty: line?.quantity ?? 0,
    lineUnit: line?.unitPriceUgx ?? 0,
    lineTotal: line?.lineTotalUgx ?? 0,
    returnCount: cloud.returnIds.length,
  };
}

function classifyWriteError(message: string | undefined, code: string | undefined): HistoricalRepairStatus {
  const text = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (text.includes("42501") || text.includes("permission") || text.includes("rls") || text.includes("not allowed")) {
    return "permission_denied";
  }
  return "write_failed";
}

export async function maybeRepairHistoricalSaleHeader(): Promise<HistoricalRepairOutcome> {
  if (attempted) {
    if (clientCanQuery()) {
      const snap = await readCloudSnapshot();
      if (snap.ok) {
        persistFacts(snap.data, { wrote: false, status: lastOutcome?.status ?? "already_attempted" });
        if (cloudHeaderRepaired(snap.data)) {
          return persistOutcome({
            status: lastOutcome?.wrote ? "repaired" : "already_repaired",
            wrote: false,
            allowReturnRecovery: true,
            after: snapshotAfter(snap.data),
          });
        }
      }
    }
    return (
      lastOutcome ??
      persistOutcome({ status: "skipped", reason: "already_attempted", wrote: false, allowReturnRecovery: false })
    );
  }
  attempted = true;

  if (!clientCanQuery()) {
    persistAudit("skipped", { reason: "no_supabase" });
    return persistOutcome({ status: "skipped", reason: "no_supabase", wrote: false, allowReturnRecovery: false });
  }

  const { getActiveShopId } = await import("../offline/shopScope");
  const activeShopId = getActiveShopId();
  const sale = await loadLocalSale();
  const ret = await loadLocalReturn();
  if (!sale || !ret) {
    persistAudit("skipped", { reason: "local_missing" });
    return persistOutcome({ status: "skipped", reason: "local_missing", wrote: false, allowReturnRecovery: false });
  }

  const { data: sessionWrap } = await supabase!.auth.getSession();
  if (!sessionWrap.session) {
    persistAudit("failed", { reason: "not_authenticated" });
    return persistOutcome({ status: "skipped", reason: "not_authenticated", wrote: false, allowReturnRecovery: false });
  }

  const cloudRead = await readCloudSnapshot();
  if (!cloudRead.ok) {
    persistAudit("failed", { reason: cloudRead.reason });
    return persistOutcome({ status: "assert_failed", reason: cloudRead.reason, wrote: false, allowReturnRecovery: false });
  }

  const afterShape = snapshotAfter(cloudRead.data);
  persistFacts(cloudRead.data, { wrote: false, status: "pre" });
  if (cloudHeaderRepaired(cloudRead.data)) {
    const localHeader = assertLocalOriginalHeader(sale, [ret]);
    if (!localHeader.ok) {
      return persistOutcome({
        status: "assert_failed",
        reason: localHeader.failures.join(","),
        wrote: false,
        allowReturnRecovery: false,
        after: afterShape,
      });
    }
    persistAudit("skipped", { reason: "already_repaired" });
    persistFacts(cloudRead.data, { wrote: false, status: "already_repaired" });
    return persistOutcome({
      status: "already_repaired",
      wrote: false,
      allowReturnRecovery: true,
      after: afterShape,
    });
  }

  const pre = assertPreWrite({
    activeShopId,
    sale,
    ret,
    returns: [ret],
    cloud: cloudRead.data,
  });
  if (!pre.ok) {
    persistAudit("failed", { reason: pre.failures.join(",") });
    persistFacts(cloudRead.data, { wrote: false, status: "assert_failed" });
    return persistOutcome({
      status: "assert_failed",
      reason: pre.failures.join(","),
      assertions: pre.failures,
      wrote: false,
      allowReturnRecovery: false,
      after: afterShape,
    });
  }

  persistAudit("pre_write");

  const write = await supabase!
    .from("sales")
    .update({
      total_ugx: ORIGINAL_TOTAL_UGX,
      cash_amount_ugx: ORIGINAL_CASH_UGX,
    })
    .eq("id", HISTORICAL_REPAIR_SALE_ID)
    .eq("shop_id", HISTORICAL_REPAIR_SHOP_ID)
    .eq("total_ugx", 0)
    .eq("cash_amount_ugx", 0)
    .select("id, total_ugx, cash_amount_ugx, debt_amount_ugx, subtotal_ugx")
    .maybeSingle();

  if (write.error) {
    const status = classifyWriteError(write.error.message, write.error.code);
    persistAudit("failed", { reason: write.error.code ?? status });
    return persistOutcome({
      status,
      reason: write.error.code ?? write.error.message ?? status,
      wrote: false,
      allowReturnRecovery: false,
    });
  }
  if (!write.data) {
    persistAudit("failed", { reason: "update_zero_rows" });
    return persistOutcome({
      status: "permission_denied",
      reason: "update_zero_rows",
      wrote: false,
      allowReturnRecovery: false,
    });
  }

  const verify = await readCloudSnapshot();
  if (!verify.ok) {
    persistAudit("failed", { reason: verify.reason });
    return persistOutcome({
      status: "verify_failed",
      reason: verify.reason,
      wrote: true,
      allowReturnRecovery: false,
    });
  }
  const verified = verify.data;
  const verifyAfter = snapshotAfter(verified);
  const verifyOk =
    verified.totalUgx === ORIGINAL_TOTAL_UGX &&
    verified.cashAmountUgx === ORIGINAL_CASH_UGX &&
    verified.debtAmountUgx === ORIGINAL_DEBT_UGX &&
    verified.subtotalUgx === ORIGINAL_TOTAL_UGX &&
    verified.lines.length === 1 &&
    verified.lines[0]?.quantity === ORIGINAL_QTY &&
    verified.lines[0]?.unitPriceUgx === ORIGINAL_TOTAL_UGX &&
    verified.lines[0]?.lineTotalUgx === ORIGINAL_TOTAL_UGX &&
    !verified.returnIds.includes(HISTORICAL_REPAIR_RETURN_ID);

  if (!verifyOk) {
    persistAudit("failed", { reason: "post_write_mismatch" });
    return persistOutcome({
      status: "verify_failed",
      reason: "post_write_mismatch",
      wrote: true,
      allowReturnRecovery: false,
      after: verifyAfter,
    });
  }

  persistFacts(verified, { wrote: true, status: "repaired" });
  return persistOutcome({
    status: "repaired",
    wrote: true,
    allowReturnRecovery: true,
    after: verifyAfter,
  });
}

export type HistoricalReturnFollowThrough = {
  returnPresent: boolean;
  returnQty?: number;
  refundUgx?: number;
  reason?: string | null;
  saleIdSuffix?: string;
  productIdSuffix?: string;
  duplicateReturns: number;
  queueRowPresent: boolean;
};

export async function verifyHistoricalReturnFollowThrough(): Promise<HistoricalReturnFollowThrough | null> {
  if (!lastOutcome?.allowReturnRecovery || !clientCanQuery() || !supabase) return null;
  const retRes = await supabase
    .from("sale_returns")
    .select("id, sale_id, product_id, quantity, refund_amount_ugx, reason")
    .eq("id", HISTORICAL_REPAIR_RETURN_ID)
    .eq("shop_id", HISTORICAL_REPAIR_SHOP_ID);
  if (retRes.error) return { returnPresent: false, duplicateReturns: 0, queueRowPresent: true };
  const rows = retRes.data ?? [];
  const row = rows.find((item) => String(item.id) === HISTORICAL_REPAIR_RETURN_ID) ?? rows[0];
  const { readSyncQueue } = await import("../offline/localDb");
  const queue = await readSyncQueue();
  const queueRowPresent = queue.some((op) => op.id === HISTORICAL_REPAIR_QUEUE_ID);
  const follow: HistoricalReturnFollowThrough = {
    returnPresent: Boolean(row),
    returnQty: row ? Number(row.quantity ?? 0) : undefined,
    refundUgx: row ? Number(row.refund_amount_ugx ?? 0) : undefined,
    reason: row?.reason != null ? String(row.reason) : null,
    saleIdSuffix: row ? idSuffix(String(row.sale_id ?? "")) : undefined,
    productIdSuffix: row ? idSuffix(String(row.product_id ?? "")) : undefined,
    duplicateReturns: rows.length,
    queueRowPresent,
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        "waka.historicalSaleRepair.return.v1",
        [
          "HSRRET",
          follow.returnPresent ? "1" : "0",
          String(follow.returnQty ?? ""),
          String(follow.refundUgx ?? ""),
          follow.reason ?? "",
          follow.saleIdSuffix ?? "",
          follow.productIdSuffix ?? "",
          String(follow.duplicateReturns),
          follow.queueRowPresent ? "1" : "0",
        ].join(","),
      );
    }
  } catch {
    /* quota */
  }
  return follow;
}
