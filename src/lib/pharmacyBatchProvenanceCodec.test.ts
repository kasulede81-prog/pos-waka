/**
 * F3 — Pharmacy batch provenance travels with the sale line.
 *
 * finalizeDraftSale stamps pharmacyBatchOverrideId / pharmacyBatchNumber / pharmacyBatchExpiry on a dispensed
 * line, and a later void/return (and a controlled-medicine return) uses them to find the batch the units came
 * from. The cloud serializers used to drop them, so on another device that lookup found nothing: the stock was
 * restored but the batch was not (integrity drift), and a controlled return was blocked outright.
 *
 * These tests run the REAL store actions (finalizeDraftSale, voidSaleLine, returnProduct,
 * recordControlledReturn), the REAL push builder (buildSalePushPayload) and the REAL decoder
 * (decodeSaleLineFromCloud), with the line going through JSON as it does in the cloud. The fields are PASSIVE
 * provenance: nothing here may restore stock, create a void/return or change an amount by itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../offline/syncEngine";
import type { Product, Sale, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { buildSalePushPayload } from "../offline/cloudSync";
import { decodeSaleLineFromCloud, encodeSaleLineForCloud, PHARMACY_BATCH_PROVENANCE_KEYS, type CloudSaleLineRow } from "./saleLineCloudCodec";
import { appendBatchToProduct, computeBatchIntegrity, createBatchOnReceive, getProductBatches } from "./pharmacyBatches";
import { resolveControlledReturnBatch } from "./pharmacyControlledReturn";

const PID = "ffffffff-2222-4fff-8fff-ffffffffffff";
const T = "2026-01-01T00:00:00.000Z";
const st = () => usePosStore.getState();
const KEYS = ["pharmacyBatchOverrideId", "pharmacyBatchNumber", "pharmacyBatchExpiry"] as const;
const LEGACY_KEYS = ["baseUnit", "cartDiscountUgx", "cogsUgx", "estimatedProfitUgx", "grossProfitUgx", "lineIndex", "name", "netRevenueUgx", "unitCostUgx"];

function pharmacyProduct(): Product {
  const p: Product = { id: PID, name: "Amoxicillin", sellingMode: "unit", baseUnit: "capsule", sellingPricePerUnitUgx: 500, costPricePerUnitUgx: 200, stockOnHand: 38, minimumStockAlert: 5, category: "Rx", sku: "", updatedAt: T, version: 1, pharmacyMaster: { batchTracked: true, expiryTracked: true, otcOrPrescription: "otc" } };
  let x = appendBatchToProduct(p, createBatchOnReceive({ batchNumber: "LOT-A", expiryDate: "2027-01-01", quantityBase: 8, unitCostUgx: 200, at: T }));
  x = appendBatchToProduct(x, createBatchOnReceive({ batchNumber: "LOT-B", expiryDate: "2027-06-01", quantityBase: 30, unitCostUgx: 200, at: T }));
  return { ...x, stockOnHand: 38 };
}
const line = (qty: number, id: string): SaleLine => ({ id, productId: PID, name: "Amoxicillin", inputMode: "quantity", quantity: qty, unitPriceUgx: 500, unitCostUgx: 200, lineTotalUgx: 500 * qty, estimatedProfitUgx: 300 * qty, updatedAt: T });
const L1 = "cccccccc-0000-4000-8000-000000000001";
const L2 = "cccccccc-0000-4000-8000-000000000002";
const batchQty = (p: Product) => Object.fromEntries(getProductBatches(p).map((b) => [b.batchNumber, b.quantityRemaining]));
const product = () => st().products.find((p) => p.id === PID)!;

function seed(products: Product[], sales: Sale[] = [], businessType: "pharmacy" | "kiosk_duka" | "hospitality" = "pharmacy") {
  usePosStore.setState({
    _hydrated: true, sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" }, products, customers: [], sales, stockMovements: [], archivedStockMovements: [],
    voidRecords: [], archivedVoidRecords: [], returnRecords: [], archivedReturnRecords: [], auditLogs: [], draftLines: [], draftCartDiscountUgx: 0, activePendingSaleId: null, draftInput: null,
    draftPaymentMethod: "cash", pharmacyPrescriptions: [], pharmacyControlledRegister: [],
    preferences: { ...st().preferences, businessType, pharmacyModeEnabled: businessType === "pharmacy", hospitalityModeEnabled: businessType === "hospitality", backOfficePin: "1234" },
  });
  expect(openTestShift().ok).toBe(true);
}

/** Device A: dispenses through the real store. */
function dispenseOnA(lines: Array<[number, string]>) {
  seed([pharmacyProduct()]);
  usePosStore.setState({ draftLines: lines.map(([q, id]) => line(q, id)) });
  const total = lines.reduce((n, [q]) => n + 500 * q, 0);
  expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash", amountPaidUgx: total }).ok).toBe(true);
  return { saleA: st().sales[0]!, productAfter: st().products[0]! };
}

/** The line as the cloud stores it (push builder -> JSON) and as another device reads it (decoder). */
function cloudRows(sale: Sale): CloudSaleLineRow[] {
  return buildSalePushPayload(sale, { shopId: "s", userId: "u" }).lines.map((l) => JSON.parse(JSON.stringify(l)) as CloudSaleLineRow);
}
const decodeRows = (rows: CloudSaleLineRow[]) => rows.map((r) => decodeSaleLineFromCloud(r));
const throughCloud = (sale: Sale): Sale => ({ ...sale, pendingSync: false, lines: decodeRows(cloudRows(sale)) });
const pull = (sale: Sale) => decodeRows(cloudRows(sale));

/** Device B: same product state after A's sale (F4 assumption: B holds the batch record), the sale read from the cloud. */
function becomeDeviceB(saleA: Sale, productAfter: Product, sale: Sale = throughCloud(saleA)) {
  seed([productAfter], [sale]);
  return sale;
}

beforeEach(() => {
  vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

// ── transport ──────────────────────────────────────────────────────────────────────────────────────────────
describe("the three fields survive push and pull", () => {
  let saleA: Sale;
  let lineA: SaleLine;
  let lotAId: string;
  beforeEach(() => {
    const dispensed = dispenseOnA([[5, L1]]);
    saleA = dispensed.saleA;
    lineA = saleA.lines[0]!;
    lotAId = getProductBatches(dispensed.productAfter).find((b) => b.batchNumber === "LOT-A")!.id;
  });

  it("the values come from the real finalize (LOT-A, its expiry, its batch id)", () => {
    expect([lineA.pharmacyBatchNumber, lineA.pharmacyBatchExpiry, lineA.pharmacyBatchOverrideId]).toEqual(["LOT-A", "2027-01-01", lotAId]);
  });

  it.each(KEYS)("1-3. %s alone survives", (key) => {
    const only: SaleLine = { ...lineA, pharmacyBatchOverrideId: null, pharmacyBatchNumber: null, pharmacyBatchExpiry: null, [key]: lineA[key] };
    const [decoded] = pull({ ...saleA, lines: [only] });
    expect(decoded![key]).toBe(lineA[key]);
    for (const other of KEYS.filter((k) => k !== key)) expect(decoded).not.toHaveProperty(other);
  });

  it("4. all three survive together, exactly", () => {
    const [decoded] = pull(saleA);
    expect([decoded!.pharmacyBatchOverrideId, decoded!.pharmacyBatchNumber, decoded!.pharmacyBatchExpiry]).toEqual([lotAId, "LOT-A", "2027-01-01"]);
    const meta = cloudRows(saleA)[0]!.metadata;
    expect(KEYS.every((k) => meta[k] === lineA[k])).toBe(true);
  });

  it("the codec encoder and the push builder write the same provenance (no drift between the two serializers)", () => {
    const fromBuilder = cloudRows(saleA)[0]!.metadata;
    const fromCodec = encodeSaleLineForCloud(lineA).metadata;
    for (const k of PHARMACY_BATCH_PROVENANCE_KEYS) expect(fromCodec[k]).toBe(fromBuilder[k]);
  });

  it("5. a line without provenance is exactly as before: no new keys pushed, none invented on pull", () => {
    const bare: SaleLine = { ...lineA, pharmacyBatchOverrideId: undefined, pharmacyBatchNumber: undefined, pharmacyBatchExpiry: undefined };
    const meta = cloudRows({ ...saleA, lines: [bare] })[0]!.metadata;
    expect(Object.keys(meta).sort()).toEqual(LEGACY_KEYS);
    const decoded = pull({ ...saleA, lines: [bare] })[0]!;
    for (const k of KEYS) expect(decoded).not.toHaveProperty(k);
    // a legacy row (metadata written before F3) decodes exactly as it always did
    const legacy = decodeSaleLineFromCloud({ id: L1, product_id: PID, quantity: 5, unit_price_ugx: 500, line_total_ugx: 2_500, line_input_mode: "quantity", metadata: { name: "Amoxicillin", unitCostUgx: 200, cogsUgx: 1_000 } });
    for (const k of KEYS) expect(legacy).not.toHaveProperty(k);
    expect([legacy.name, legacy.lineTotalUgx, legacy.cogsUgx]).toEqual(["Amoxicillin", 2_500, 1_000]);
  });
});

describe("other business types are untouched", () => {
  it("6. a Retail line carries exactly the same metadata keys as before", () => {
    seed([{ ...pharmacyProduct(), pharmacyMaster: undefined, pharmacyPackaging: undefined }], [], "kiosk_duka");
    usePosStore.setState({ draftLines: [line(3, L1)] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    const sale = st().sales[0]!;
    expect(Object.keys(cloudRows(sale)[0]!.metadata).sort()).toEqual(LEGACY_KEYS);
    for (const k of KEYS) expect(pull(sale)[0]).not.toHaveProperty(k);
  });

  it("7. a Hospitality line carries exactly the same metadata keys as before", () => {
    seed([{ ...pharmacyProduct(), pharmacyMaster: undefined, pharmacyPackaging: undefined }], [], "hospitality");
    usePosStore.setState({ draftLines: [line(3, L1)] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    const sale = st().sales[0]!;
    expect(Object.keys(cloudRows(sale)[0]!.metadata).sort()).toEqual(LEGACY_KEYS);
    for (const k of KEYS) expect(pull(sale)[0]).not.toHaveProperty(k);
  });
});

describe("malformed provenance fails closed (no provenance, never an invented batch)", () => {
  const malformed: Array<[string, unknown]> = [["null", null], ["a number", 42], ["an object", { id: "LOT-A" }], ["an array", ["LOT-A"]], ["a boolean", true], ["an empty string", ""], ["whitespace", "   "]];

  it.each(malformed)("a pushed line with %s in every field writes nothing and reads back as no provenance", (_n, bad) => {
    const { saleA } = dispenseOnA([[5, L1]]);
    const poisoned = { ...saleA.lines[0]!, pharmacyBatchOverrideId: bad, pharmacyBatchNumber: bad, pharmacyBatchExpiry: bad } as unknown as SaleLine;
    const meta = cloudRows({ ...saleA, lines: [poisoned] })[0]!.metadata;
    for (const k of KEYS) expect(meta).not.toHaveProperty(k);
  });

  it.each(malformed)("a stored row with %s in every field decodes to no provenance", (_n, bad) => {
    const { saleA } = dispenseOnA([[5, L1]]);
    const row = cloudRows(saleA)[0]!;
    const decoded = decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, pharmacyBatchOverrideId: bad, pharmacyBatchNumber: bad, pharmacyBatchExpiry: bad } });
    for (const k of KEYS) expect(decoded).not.toHaveProperty(k);
  });

  it("the codec has no expiry format rule (it is a display snapshot): any non-empty string is carried, anything else is dropped", () => {
    const { saleA } = dispenseOnA([[5, L1]]);
    const row = cloudRows(saleA)[0]!;
    expect(decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, pharmacyBatchExpiry: "not-a-date" } }).pharmacyBatchExpiry).toBe("not-a-date");
    expect(decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, pharmacyBatchExpiry: 20270101 } })).not.toHaveProperty("pharmacyBatchExpiry");
  });

  it("malformed provenance on Device B restores NO batch (stock stays canonical, the drift stays visible) and creates none", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    const row = cloudRows(saleA)[0]!;
    const poisoned = { ...saleA, pendingSync: false, lines: [decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, pharmacyBatchOverrideId: {}, pharmacyBatchNumber: 42, pharmacyBatchExpiry: null } })] };
    becomeDeviceB(saleA, productAfter, poisoned);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(product().stockOnHand).toBe(38); // the canonical restore still happened
    expect(batchQty(product())).toEqual({ "LOT-A": 3, "LOT-B": 30 }); // no batch guessed
    expect(computeBatchIntegrity(product()).ok).toBe(false); // the drift is visible, exactly as before F3
  });

  it("a malformed id with a VALID number falls back to the number (the existing resolver), a valid id of a missing batch does nothing", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    const row = cloudRows(saleA)[0]!;
    const withNumberOnly = { ...saleA, pendingSync: false, lines: [decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, pharmacyBatchOverrideId: {} } })] };
    becomeDeviceB(saleA, productAfter, withNumberOnly);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(batchQty(product())).toEqual({ "LOT-A": 8, "LOT-B": 30 });
    const ghost = { ...saleA, pendingSync: false, lines: [decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, pharmacyBatchOverrideId: "no-such-batch", pharmacyBatchNumber: "NO-SUCH-LOT" } })] };
    becomeDeviceB(saleA, productAfter, ghost);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(batchQty(product())).toEqual({ "LOT-A": 3, "LOT-B": 30 });
  });
});

// ── Device B ───────────────────────────────────────────────────────────────────────────────────────────────
describe("8. Device A: dispensing is unchanged", () => {
  it("stock, batches, amounts and COGS are exactly what finalizeDraftSale always produced", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    expect(productAfter.stockOnHand).toBe(33);
    expect(batchQty(productAfter)).toEqual({ "LOT-A": 3, "LOT-B": 30 });
    expect(computeBatchIntegrity(productAfter).ok).toBe(true);
    expect([saleA.subtotalUgx, saleA.totalUgx, saleA.cashPaidUgx, saleA.debtUgx]).toEqual([2_500, 2_500, 2_500, 0]);
    expect([saleA.lines[0]!.unitCostUgx, saleA.lines[0]!.cogsUgx]).toEqual([200, 1_000]);
    expect(st().sales).toHaveLength(1);
    // sending the sale changes nothing about it
    const before = JSON.stringify(saleA);
    cloudRows(saleA);
    expect(JSON.stringify(saleA)).toBe(before);
  });
});

describe("9. Device B voids a Pharmacy sale", () => {
  it("restores the correct batch (LOT-A) through the existing resolver; stock goes through the canonical mechanism", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    becomeDeviceB(saleA, productAfter);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(product().stockOnHand).toBe(38);
    expect(batchQty(product())).toEqual({ "LOT-A": 8, "LOT-B": 30 });
    expect(computeBatchIntegrity(product()).ok).toBe(true); // the drift Device B used to show is gone
    expect(st().voidRecords).toHaveLength(1);
  });

  it("12. Device A and Device B produce the SAME void record for the same line, and a second void is rejected", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "A" }).ok).toBe(true);
    const idOnA = st().voidRecords[0]!.id;
    becomeDeviceB(saleA, productAfter);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(st().voidRecords[0]!.id).toBe(idOnA); // deterministic: the cloud dedupes them
    const stockAfter = product().stockOnHand;
    const batchesAfter = batchQty(product());
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "again" }).ok).toBe(false); // the existing guard
    expect(product().stockOnHand).toBe(stockAfter);
    expect(batchQty(product())).toEqual(batchesAfter);
    expect(st().voidRecords).toHaveLength(1);
  });
});

describe("10. Device B returns part of a Pharmacy sale", () => {
  it("each partial return resolves LOT-A and stays within the existing return limits", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    becomeDeviceB(saleA, productAfter);
    const ret = (qty: number, k: number) => st().returnProduct({ saleId: saleA.id, productId: PID, quantity: qty, refundAmountUgx: 500 * qty - k, reason: "wrong_item", note: "n", saleLineId: L1 });
    expect(ret(2, 1).ok).toBe(true);
    expect(product().stockOnHand).toBe(35);
    expect(batchQty(product())).toEqual({ "LOT-A": 5, "LOT-B": 30 });
    expect(ret(1, 2).ok).toBe(true);
    expect(batchQty(product())).toEqual({ "LOT-A": 6, "LOT-B": 30 });
    // the existing ceiling still applies: only 2 units are left to return
    const stock = product().stockOnHand;
    expect(ret(3, 3).ok).toBe(false);
    expect(product().stockOnHand).toBe(stock);
    expect(batchQty(product())).toEqual({ "LOT-A": 6, "LOT-B": 30 });
  });
});

describe("11. controlled-medicine return on Device B", () => {
  it("no longer fails because the batch provenance was lost: the resolver and the real action use LOT-A", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    const saleB = becomeDeviceB(saleA, productAfter);
    expect(resolveControlledReturnBatch({ product: product(), quantity: 2, sale: saleB, productId: PID })).toMatchObject({ ok: true, batchNumber: "LOT-A", batchExpiry: "2027-01-01" });
    const r = st().recordControlledReturn({ disposition: "return", productId: PID, quantity: 2, reason: "patient returned", managerPin: "1234", saleId: saleA.id });
    expect(r.ok).toBe(true);
    expect(product().stockOnHand).toBe(35);
    expect(batchQty(product())).toEqual({ "LOT-A": 5, "LOT-B": 30 });
    expect(st().pharmacyControlledRegister[0]?.batchNumber).toBe("LOT-A");
  });

  it("the safeguards are untouched: a wrong manager PIN is still refused, and a legacy line without provenance still requires a batch", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    becomeDeviceB(saleA, productAfter);
    const wrong = st().recordControlledReturn({ disposition: "return", productId: PID, quantity: 2, reason: "x", managerPin: "9999", saleId: saleA.id });
    expect(wrong).toMatchObject({ ok: false, errorKey: "pinIncorrect" });
    expect(product().stockOnHand).toBe(33);
    const legacySale: Sale = { ...saleA, pendingSync: false, lines: saleA.lines.map((l) => ({ ...l, pharmacyBatchOverrideId: undefined, pharmacyBatchNumber: undefined, pharmacyBatchExpiry: undefined })) };
    becomeDeviceB(saleA, productAfter, legacySale);
    expect(resolveControlledReturnBatch({ product: product(), quantity: 2, sale: legacySale, productId: PID })).toEqual({ ok: false, errorKey: "pharmacyControlledReturnBatchRequired" });
    expect(st().recordControlledReturn({ disposition: "return", productId: PID, quantity: 2, reason: "x", managerPin: "1234", saleId: saleA.id })).toMatchObject({ ok: false, errorKey: "pharmacyControlledReturnBatchRequired" });
  });
});

describe("13. two lines of the same product keep independent provenance", () => {
  it("LOT-A for the first line, LOT-B for the second; each void restores only its own batch", () => {
    const { saleA, productAfter } = dispenseOnA([[8, L1], [4, L2]]);
    expect(saleA.lines.map((l) => l.pharmacyBatchNumber)).toEqual(["LOT-A", "LOT-B"]);
    expect(batchQty(productAfter)).toEqual({ "LOT-A": 0, "LOT-B": 26 });
    const decoded = pull(saleA);
    expect(decoded.map((l) => [l.id, l.pharmacyBatchNumber, l.pharmacyBatchOverrideId])).toEqual(saleA.lines.map((l) => [l.id, l.pharmacyBatchNumber, l.pharmacyBatchOverrideId]));
    expect(decoded[0]!.pharmacyBatchOverrideId).not.toBe(decoded[1]!.pharmacyBatchOverrideId);
    becomeDeviceB(saleA, productAfter);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 1, reason: "other", note: "B" }).ok).toBe(true);
    expect(batchQty(product())).toEqual({ "LOT-A": 0, "LOT-B": 30 });
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(batchQty(product())).toEqual({ "LOT-A": 8, "LOT-B": 30 });
    expect(product().stockOnHand).toBe(38);
    expect(computeBatchIntegrity(product()).ok).toBe(true);
  });
});

// ── passivity ──────────────────────────────────────────────────────────────────────────────────────────────
describe("the provenance is passive", () => {
  it("receiving a sale with provenance changes no stock, batch, record or amount by itself", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    const withProv = throughCloud(saleA);
    const withoutProv: Sale = { ...withProv, lines: withProv.lines.map((l) => ({ ...l, pharmacyBatchOverrideId: undefined, pharmacyBatchNumber: undefined, pharmacyBatchExpiry: undefined })) };
    const snapshot = () => JSON.stringify({ stock: product().stockOnHand, batches: batchQty(product()), voids: st().voidRecords, returns: st().returnRecords, moves: st().stockMovements, register: st().pharmacyControlledRegister });
    becomeDeviceB(saleA, productAfter, withProv);
    const a = snapshot();
    becomeDeviceB(saleA, productAfter, withoutProv);
    expect(snapshot()).toBe(a);
    const money = (s: Sale) => [s.subtotalUgx, s.totalUgx, s.cashPaidUgx, s.debtUgx, s.lines.map((l) => [l.lineTotalUgx, l.unitCostUgx, l.cogsUgx, l.estimatedProfitUgx])];
    expect(money(withProv)).toEqual(money(withoutProv));
  });

  it("it does not bypass the void guard: an already-voided line stays un-voidable however complete its provenance is", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    const voided: Sale = { ...throughCloud(saleA), lines: throughCloud(saleA).lines.map((l) => ({ ...l, voided: true })) };
    becomeDeviceB(saleA, productAfter, voided);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(false);
    expect(product().stockOnHand).toBe(33);
    expect(batchQty(product())).toEqual({ "LOT-A": 3, "LOT-B": 30 });
  });

  it("it does not bypass the return guard: a return above the quantity sold is refused and restores nothing", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    becomeDeviceB(saleA, productAfter);
    const r = st().returnProduct({ saleId: saleA.id, productId: PID, quantity: 6, refundAmountUgx: 2_999, reason: "wrong_item", note: "n", saleLineId: L1 });
    expect(r.ok).toBe(false);
    expect(product().stockOnHand).toBe(33);
    expect(batchQty(product())).toEqual({ "LOT-A": 3, "LOT-B": 30 });
  });

  it("14. batch-integrity behaviour is unchanged: it reports drift exactly as before, and none after a correct restore", () => {
    const { saleA, productAfter } = dispenseOnA([[5, L1]]);
    expect(computeBatchIntegrity(productAfter)).toMatchObject({ ok: true, stockOnHand: 33, batchSum: 33, delta: 0 });
    const noProv: Sale = { ...throughCloud(saleA), lines: throughCloud(saleA).lines.map((l) => ({ ...l, pharmacyBatchOverrideId: undefined, pharmacyBatchNumber: undefined })) };
    becomeDeviceB(saleA, productAfter, noProv);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(computeBatchIntegrity(product())).toMatchObject({ ok: false, stockOnHand: 38, batchSum: 33, delta: 5 });
  });
});
