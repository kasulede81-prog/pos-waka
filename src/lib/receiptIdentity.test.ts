/**
 * WAKA-10 — receipt identity is device-qualified, stamped at mint, never rewritten.
 *
 * AUDIT: two terminals in one shop each complete a sale on the same Kampala day
 * before syncing. `scanTodaySalesHead(...).nextReceiptSeq` used only local
 * sales, so both minted receiptSeq 14 and both printed INV-000014.
 */

import { describe, expect, it } from "vitest";
import type { Sale, SaleLine } from "../types";
import { mergeSaleFromCloudPull } from "./saleFinancialMerge";
import { buildSalePushPayload } from "../offline/cloudSync";
import { buildReceiptNumberForSale, buildReceiptDisplayData } from "./receiptPrint";
import { buildRetailReceiptEscPos } from "./retailReceiptEscPos";
import { defaultReceiptDisplayOptions } from "./receiptBranding";
import { scanTodaySalesHead } from "./salesDayIndex";
import {
  formatPersistedReceiptIdentity,
  formatReceiptIdentityForUi,
  mintLocalReceiptIdentity,
  saleReceiptIdentityKey,
} from "./receiptIdentity";
import { activityReferenceLabel } from "./customerAccountDocuments";
import { buildCreditActivityTimeline } from "./customerDebtActivity";

const TODAY = "2026-09-08";
const CREATED = "2026-09-08T10:00:00.000Z";
const DEVICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHOP = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function line(): SaleLine {
  return {
    id: "line-1",
    productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Soap",
    quantity: 1,
    unitPriceUgx: 2000,
    unitCostUgx: 500,
    estimatedProfitUgx: 1500,
    inputMode: "quantity",
    lineTotalUgx: 2000,
  };
}

function sale(partial: Partial<Sale> = {}): Sale {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "completed",
    lines: [line()],
    subtotalUgx: 2000,
    totalUgx: 2000,
    cashPaidUgx: 2000,
    debtUgx: 0,
    estimatedProfitUgx: 1500,
    createdAt: CREATED,
    updatedAt: CREATED,
    pendingSync: false,
    ...partial,
  };
}

function priorSales(deviceId: string, count: number): Sale[] {
  const terminal = mintLocalReceiptIdentity([], deviceId, TODAY).receiptTerminal;
  const rows: Sale[] = [];
  for (let seq = count; seq >= 1; seq--) {
    rows.push(
      sale({
        id: crypto.randomUUID(),
        receiptSeq: seq,
        receiptTerminal: terminal,
        createdAt: `2026-09-08T09:${String(seq).padStart(2, "0")}:00.000Z`,
      }),
    );
  }
  return rows;
}

function decodeEscPosText(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b || b === 0x1d) {
      i += 1;
      continue;
    }
    if (b >= 32 && b < 127) out += String.fromCharCode(b);
    if (b === 0x0a) out += "\n";
  }
  return out;
}

describe("WAKA-10 receipt identity", () => {
  it("1 — two offline sales on one till receive distinct receipt identities", () => {
    const first = mintLocalReceiptIdentity([], DEVICE_A, TODAY);
    const firstSale = sale({ id: crypto.randomUUID(), ...first });
    const second = mintLocalReceiptIdentity([firstSale], DEVICE_A, TODAY);
    expect(formatPersistedReceiptIdentity(first)).not.toBe(formatPersistedReceiptIdentity(second));
    expect(saleReceiptIdentityKey(firstSale)).not.toBe(
      saleReceiptIdentityKey({ ...firstSale, ...second }),
    );
  });

  it("8 — audit: two tills minting the 14th sale of the day before sync get distinct identities", () => {
    const mintA = mintLocalReceiptIdentity(priorSales(DEVICE_A, 13), DEVICE_A, TODAY);
    const mintB = mintLocalReceiptIdentity(priorSales(DEVICE_B, 13), DEVICE_B, TODAY);
    expect(mintA.receiptSeq).toBe(14);
    expect(mintB.receiptSeq).toBe(14);
    expect(mintA.receiptTerminal).not.toBe(mintB.receiptTerminal);

    const saleA = sale({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ...mintA,
    });
    const saleB = sale({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ...mintB,
    });
    expect(formatPersistedReceiptIdentity(saleA)).toBe("AAAA-014");
    expect(formatPersistedReceiptIdentity(saleB)).toBe("BBBB-014");
    expect(saleReceiptIdentityKey(saleA)).not.toBe(saleReceiptIdentityKey(saleB));
    expect(buildReceiptNumberForSale(saleA, [saleA, saleB])).not.toBe(
      buildReceiptNumberForSale(saleB, [saleA, saleB]),
    );
  });

  it("2 — after both tills sync, the same (day, terminal, seq) cannot name two sales", () => {
    const mintA = mintLocalReceiptIdentity(priorSales(DEVICE_A, 13), DEVICE_A, TODAY);
    const mintB = mintLocalReceiptIdentity(priorSales(DEVICE_B, 13), DEVICE_B, TODAY);
    const saleA = sale({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...mintA });
    const saleB = sale({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ...mintB });
    const mergedNewestFirst = [saleB, saleA, ...priorSales(DEVICE_A, 13), ...priorSales(DEVICE_B, 13)];
    const keys = mergedNewestFirst
      .map((s) => saleReceiptIdentityKey(s))
      .filter((k): k is string => k != null);
    expect(new Set(keys).size).toBe(keys.length);

    const nextA = mintLocalReceiptIdentity(mergedNewestFirst, DEVICE_A, TODAY);
    const nextB = mintLocalReceiptIdentity(mergedNewestFirst, DEVICE_B, TODAY);
    expect(nextA.receiptSeq).toBe(15);
    expect(nextB.receiptSeq).toBe(15);
    expect(formatPersistedReceiptIdentity(nextA)).not.toBe(formatPersistedReceiptIdentity(nextB));
  });

  it("3 — retrying the same queued sale does not mint a second receipt", () => {
    const minted = mintLocalReceiptIdentity(priorSales(DEVICE_A, 13), DEVICE_A, TODAY);
    const queued = sale({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ...minted,
      pendingSync: true,
    });
    const first = buildSalePushPayload(queued, { shopId: SHOP, userId: USER });
    const retry = buildSalePushPayload(queued, { shopId: SHOP, userId: USER });
    expect(first.sale.id).toBe(queued.id);
    expect(retry.sale.id).toBe(queued.id);
    expect(first.sale.metadata).toMatchObject({ receiptSeq: 14, receiptTerminal: "AAAA" });
    expect(retry.sale.metadata).toMatchObject({ receiptSeq: 14, receiptTerminal: "AAAA" });
    expect(queued.receiptSeq).toBe(14);
    expect(formatPersistedReceiptIdentity(queued)).toBe("AAAA-014");
    const nextNewSale = mintLocalReceiptIdentity([queued, ...priorSales(DEVICE_A, 13)], DEVICE_A, TODAY);
    expect(nextNewSale.receiptSeq).toBe(15);
  });

  it("4 / 5 — cloud push metadata is the stamped identity; merge prefers local over a later cloud rewrite", () => {
    const local = sale({
      receiptSeq: 14,
      receiptTerminal: "AAAA",
      updatedAt: "2026-09-08T10:00:00.000Z",
    });
    const payload = buildSalePushPayload(local, { shopId: SHOP, userId: USER });
    expect(payload.sale.metadata).toMatchObject({ receiptSeq: 14, receiptTerminal: "AAAA" });

    const remoteRewrite = sale({
      receiptSeq: 99,
      receiptTerminal: "ZZZZ",
      updatedAt: "2026-09-08T12:00:00.000Z",
    });
    const merged = mergeSaleFromCloudPull(local, remoteRewrite);
    expect(merged.receiptSeq).toBe(14);
    expect(merged.receiptTerminal).toBe("AAAA");
    expect(formatPersistedReceiptIdentity(merged)).toBe("AAAA-014");
  });

  it("6 — recovery/bootstrap does not change an existing sale's receipt identity", () => {
    const local = sale({
      receiptSeq: 14,
      receiptTerminal: "AAAA",
      updatedAt: "2026-09-08T10:00:00.000Z",
    });
    const remoteMissing = sale({
      receiptSeq: undefined,
      receiptTerminal: undefined,
      updatedAt: "2026-09-08T12:00:00.000Z",
    });
    const recovered = mergeSaleFromCloudPull(local, remoteMissing);
    expect(recovered.receiptSeq).toBe(14);
    expect(recovered.receiptTerminal).toBe("AAAA");

    const emptyLocal = sale({
      receiptSeq: undefined,
      receiptTerminal: undefined,
      pendingSync: false,
    });
    const cloudOriginal = sale({ receiptSeq: 7, receiptTerminal: "BBBB" });
    const bootstrapped = mergeSaleFromCloudPull(emptyLocal, cloudOriginal);
    expect(bootstrapped.receiptSeq).toBe(7);
    expect(bootstrapped.receiptTerminal).toBe("BBBB");
  });

  it("7 — printed and thermal receipts use the persisted sale identity, not a day-index fallback", () => {
    const persisted = sale({ receiptSeq: 14, receiptTerminal: "AAAA" });
    const otherSameSeq = sale({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      receiptSeq: 14,
      receiptTerminal: "BBBB",
    });
    const printed = buildReceiptNumberForSale(persisted, [otherSameSeq, persisted]);
    expect(printed).toBe("AAAA-014");
    expect(printed).not.toBe("INV-000014");
    expect(printed).not.toBe("INV-000002");

    const display = buildReceiptDisplayData({
      shopName: "Waka Test Shop",
      cashier: "Amina",
      receiptNumber: printed,
      sale: persisted,
      displayOptions: defaultReceiptDisplayOptions(),
    });
    expect(display.receiptNumber).toBe("AAAA-014");
    const text = decodeEscPosText(buildRetailReceiptEscPos(display));
    expect(text).toContain("AAAA-014");
    expect(text).not.toContain("INV-000014");
  });

  it("legacy untagged receipts keep INV-/UI # formatting and pending rows do not consume seq", () => {
    expect(formatPersistedReceiptIdentity({ receiptSeq: 14 })).toBe("INV-000014");
    expect(formatReceiptIdentityForUi({ receiptSeq: 14 })).toBe("#014");
    expect(activityReferenceLabel({ id: "s1", kind: "credit_sale", at: CREATED, amountUgx: 1, deltaUgx: 1, receiptSeq: 12 })).toBe(
      "#012",
    );
    const credit = sale({
      customerId: "c1",
      debtUgx: 5000,
      cashPaidUgx: 0,
      receiptSeq: 14,
      receiptTerminal: "AAAA",
    });
    const timeline = buildCreditActivityTimeline("c1", [credit], []);
    expect(activityReferenceLabel(timeline[0]!)).toBe("AAAA-014");

    const pending = sale({ status: "pending", receiptSeq: undefined });
    const cancelled = sale({ status: "cancelled", receiptSeq: undefined, id: crypto.randomUUID() });
    const completed = sale({ receiptSeq: 3, receiptTerminal: "AAAA", id: crypto.randomUUID() });
    expect(scanTodaySalesHead([pending, cancelled, completed], TODAY, "AAAA").nextReceiptSeq).toBe(4);
  });
});
