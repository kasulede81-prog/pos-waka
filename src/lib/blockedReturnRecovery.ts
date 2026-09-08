/**
 * Read-only probe bookkeeping for BLOCKED pending_returns recovery.
 * Never ACKs, never mutates the queue row, never calls shop_push_sale_return.
 */

export type BlockedReturnProbeBlocker =
  | "not_blocked_kind"
  | "no_supabase"
  | "not_authenticated"
  | "no_shop_ctx"
  | "no_return"
  | "select_error"
  | "select_empty"
  | "ceiling"
  | "none";

export type BlockedReturnProbeRecord = {
  at: string;
  ok: boolean;
  blocker: BlockedReturnProbeBlocker;
  /** Bumped so forensic dumps can be distinguished from the short 07 probe. */
  probeVersion?: number;
  ceilingError?: string;
  cloudSaleTotalUgx?: number | null;
  saleRowPresent?: boolean;
  selectErrorCode?: string | null;
  queueIdSuffix?: string;
  returnIdSuffix?: string;
  saleIdSuffix?: string;
  /** Read-only forensic fields. No PII. */
  cloud?: {
    totalUgx?: number | null;
    cashAmountUgx?: number | null;
    debtAmountUgx?: number | null;
    subtotalUgx?: number | null;
    discountUgx?: number | null;
    status?: string | null;
    paymentStatus?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    completedAt?: string | null;
    shopIdSuffix?: string;
    metadataKeys?: string[];
    voidedTotalPresent?: boolean;
    lines?: Array<{
      productIdSuffix: string;
      quantity: number;
      unitPriceUgx: number | null;
      lineTotalUgx: number;
      lineDiscountUgx: number | null;
    }>;
    returns?: Array<{
      idSuffix: string;
      productIdSuffix: string;
      quantity: number;
      refundAmountUgx: number;
      reason?: string | null;
      createdAt?: string | null;
      shopIdSuffix?: string;
    }>;
  };
  local?: {
    totalUgx?: number;
    cashPaidUgx?: number;
    debtUgx?: number;
    subtotalUgx?: number;
    discountTotalUgx?: number | null;
    voidedTotalUgx?: number | null;
    tenderCashUgx?: number | null;
    paymentMethod?: string | null;
    status?: string | null;
    createdAt?: string | null;
    pendingSync?: boolean;
    cloudCompleteTotalUgx?: number | null;
    lineCount?: number;
    lines?: Array<{
      productIdSuffix: string;
      quantity: number;
      unitPriceUgx: number;
      lineTotalUgx: number;
      voided?: boolean;
    }>;
    returnQty?: number;
    returnRefundUgx?: number;
    returnReason?: string | null;
    returnCreatedAt?: string | null;
    saleOutDelta?: number | null;
    saleOutSummary?: string | null;
  };
};

const STORAGE_KEY = "waka.blockedReturnProbe.v1";
const FLAT_STORAGE_KEY = "waka.brp.flat.v1";
const CSV_STORAGE_KEY = "waka.brp.csv.v1";

let lastProbe: BlockedReturnProbeRecord | null = null;
const recoveryAttempted = new Set<string>();

export function idSuffix(id: string | null | undefined): string {
  const value = String(id ?? "").trim();
  if (value.length < 4) return value;
  return value.slice(-4);
}

/** True when cloud already has this exact ReturnRecord. Used to ACK leftover queue rows without replaying 086. */
export function cloudReturnAlreadySynced(input: {
  returnId: string;
  saleId: string | null | undefined;
  productId: string;
  quantity: number;
  refundUgx: number;
  cloudReturns: Array<{
    id: string;
    saleId?: string | null;
    productId: string;
    quantity: number;
    refundAmountUgx: number;
  }>;
}): boolean {
  const returnId = String(input.returnId ?? "").trim();
  if (!returnId) return false;
  const match = input.cloudReturns.find((row) => String(row.id) === returnId);
  if (!match) return false;
  const cloudSale = match.saleId != null ? String(match.saleId).trim() : "";
  const localSale = input.saleId != null ? String(input.saleId).trim() : "";
  if (cloudSale && localSale && cloudSale !== localSale) return false;
  if (String(match.productId) !== String(input.productId)) return false;
  if (Number(match.quantity) !== Number(input.quantity)) return false;
  if (Math.floor(Number(match.refundAmountUgx) || 0) !== Math.floor(Number(input.refundUgx) || 0)) return false;
  return true;
}

export function readLastBlockedReturnProbe(): BlockedReturnProbeRecord | null {
  return lastProbe;
}

export function recordBlockedReturnProbe(
  partial: Omit<BlockedReturnProbeRecord, "at"> & { at?: string },
): boolean {
  lastProbe = {
    ...partial,
    probeVersion: partial.probeVersion ?? 2,
    at: partial.at ?? new Date().toISOString(),
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lastProbe));
      localStorage.setItem(FLAT_STORAGE_KEY, flattenBlockedReturnProbe(lastProbe));
      localStorage.setItem(CSV_STORAGE_KEY, csvBlockedReturnProbe(lastProbe));
    }
  } catch {
    /* quota / private mode */
  }
  return lastProbe.ok;
}

/** ASCII one-liner for forensic dumps (Chrome LS UTF-16 JSON is hard to recover from LevelDB). */
export function flattenBlockedReturnProbe(probe: BlockedReturnProbeRecord): string {
  const cloud = probe.cloud;
  const local = probe.local;
  const cloudLine = cloud?.lines?.[0];
  const localLine = local?.lines?.[0];
  const cloudReturn = cloud?.returns?.[0];
  return [
    `v=${probe.probeVersion ?? ""}`,
    `ok=${probe.ok ? "1" : "0"}`,
    `blocker=${probe.blocker}`,
    `err=${probe.ceilingError ?? ""}`,
    `q=${probe.queueIdSuffix ?? ""}`,
    `r=${probe.returnIdSuffix ?? ""}`,
    `s=${probe.saleIdSuffix ?? ""}`,
    `cTotal=${cloud?.totalUgx ?? ""}`,
    `cCash=${cloud?.cashAmountUgx ?? ""}`,
    `cDebt=${cloud?.debtAmountUgx ?? ""}`,
    `cSub=${cloud?.subtotalUgx ?? ""}`,
    `cDisc=${cloud?.discountUgx ?? ""}`,
    `cStat=${cloud?.status ?? ""}`,
    `cPay=${cloud?.paymentStatus ?? ""}`,
    `cAt=${cloud?.createdAt ?? ""}`,
    `cUp=${cloud?.updatedAt ?? ""}`,
    `cDone=${cloud?.completedAt ?? ""}`,
    `cKeys=${(cloud?.metadataKeys ?? []).join(",")}`,
    `cLineN=${cloud?.lines?.length ?? 0}`,
    `cLpid=${cloudLine?.productIdSuffix ?? ""}`,
    `cLqty=${cloudLine?.quantity ?? ""}`,
    `cLunit=${cloudLine?.unitPriceUgx ?? ""}`,
    `cLtot=${cloudLine?.lineTotalUgx ?? ""}`,
    `cLdisc=${cloudLine?.lineDiscountUgx ?? ""}`,
    `cRetN=${cloud?.returns?.length ?? 0}`,
    `cRid=${cloudReturn?.idSuffix ?? ""}`,
    `cRqty=${cloudReturn?.quantity ?? ""}`,
    `cRamt=${cloudReturn?.refundAmountUgx ?? ""}`,
    `lTotal=${local?.totalUgx ?? ""}`,
    `lCash=${local?.cashPaidUgx ?? ""}`,
    `lDebt=${local?.debtUgx ?? ""}`,
    `lSub=${local?.subtotalUgx ?? ""}`,
    `lDisc=${local?.discountTotalUgx ?? ""}`,
    `lVoid=${local?.voidedTotalUgx ?? ""}`,
    `lTender=${local?.tenderCashUgx ?? ""}`,
    `lPay=${local?.paymentMethod ?? ""}`,
    `lStat=${local?.status ?? ""}`,
    `lAt=${local?.createdAt ?? ""}`,
    `lPend=${local?.pendingSync ?? ""}`,
    `lSnap=${local?.cloudCompleteTotalUgx ?? ""}`,
    `lN=${local?.lineCount ?? ""}`,
    `lLpid=${localLine?.productIdSuffix ?? ""}`,
    `lLqty=${localLine?.quantity ?? ""}`,
    `lLunit=${localLine?.unitPriceUgx ?? ""}`,
    `lLtot=${localLine?.lineTotalUgx ?? ""}`,
    `lLvoid=${localLine?.voided ?? ""}`,
    `rQty=${local?.returnQty ?? ""}`,
    `rAmt=${local?.returnRefundUgx ?? ""}`,
    `rWhy=${local?.returnReason ?? ""}`,
    `rAt=${local?.returnCreatedAt ?? ""}`,
    `out=${local?.saleOutDelta ?? ""}`,
    `sum=${local?.saleOutSummary ?? ""}`,
    `at=${probe.at}`,
  ].join("|");
}

/** Compact numeric dump. Column order is fixed; no repeated prefixes. */
export function csvBlockedReturnProbe(probe: BlockedReturnProbeRecord): string {
  const cloud = probe.cloud;
  const local = probe.local;
  const cloudLine = cloud?.lines?.[0];
  const localLine = local?.lines?.[0];
  const cloudReturn = cloud?.returns?.[0];
  return [
    "BRP2",
    probe.ok ? "1" : "0",
    probe.blocker,
    probe.ceilingError ?? "",
    String(cloud?.totalUgx ?? ""),
    String(cloud?.cashAmountUgx ?? ""),
    String(cloud?.debtAmountUgx ?? ""),
    String(cloud?.subtotalUgx ?? ""),
    String(cloud?.discountUgx ?? ""),
    cloud?.status ?? "",
    cloud?.paymentStatus ?? "",
    cloud?.createdAt ?? "",
    cloud?.updatedAt ?? "",
    cloud?.completedAt ?? "",
    String(cloud?.lines?.length ?? 0),
    cloudLine?.productIdSuffix ?? "",
    String(cloudLine?.quantity ?? ""),
    String(cloudLine?.unitPriceUgx ?? ""),
    String(cloudLine?.lineTotalUgx ?? ""),
    String(cloudLine?.lineDiscountUgx ?? ""),
    String(cloud?.returns?.length ?? 0),
    cloudReturn?.idSuffix ?? "",
    String(local?.totalUgx ?? ""),
    String(local?.cashPaidUgx ?? ""),
    String(local?.debtUgx ?? ""),
    String(local?.subtotalUgx ?? ""),
    String(local?.discountTotalUgx ?? ""),
    String(local?.voidedTotalUgx ?? ""),
    String(local?.tenderCashUgx ?? ""),
    local?.paymentMethod ?? "",
    local?.status ?? "",
    local?.createdAt ?? "",
    String(local?.pendingSync ?? ""),
    String(local?.cloudCompleteTotalUgx ?? ""),
    String(local?.lineCount ?? ""),
    localLine?.productIdSuffix ?? "",
    String(localLine?.quantity ?? ""),
    String(localLine?.unitPriceUgx ?? ""),
    String(localLine?.lineTotalUgx ?? ""),
    String(localLine?.voided ?? ""),
    String(local?.returnQty ?? ""),
    String(local?.returnRefundUgx ?? ""),
    local?.returnReason ?? "",
    local?.returnCreatedAt ?? "",
    String(local?.saleOutDelta ?? ""),
    local?.saleOutSummary ?? "",
    probe.at,
  ].join(",");
}

export function hasBlockedReturnRecoveryAttempt(opId: string): boolean {
  return recoveryAttempted.has(`v3:${String(opId ?? "").trim()}`);
}

export function markBlockedReturnRecoveryAttempted(opId: string): void {
  const id = String(opId ?? "").trim();
  if (id) recoveryAttempted.add(`v3:${id}`);
}

export function resetBlockedReturnRecoveryForTests(): void {
  lastProbe = null;
  recoveryAttempted.clear();
}

/** Forensic-only: allow one more authenticated SELECT after a code reload. */
export function clearBlockedReturnRecoveryAttempts(): void {
  recoveryAttempted.clear();
}
