/**
 * F4-A / R11 — a pull must never erase a product's pharmacy batches merely because `pharmacyPackaging.enabled`
 * is false.
 *
 * `pharmacyPackaging` is both the SELLING configuration (active only when `enabled`) and the container of the
 * batch collection. appendBatchToProduct and product creation both build `{ enabled: false, ..., batches }`
 * for a batch-tracked product without packaging levels. rowToProduct read that back through
 * normalizePharmacyPackaging, which returned null for `enabled !== true`: the batches were pushed to the cloud
 * and then erased by the device's own next pull, with computeBatchIntegrity staying "ok" (nothing left to
 * disagree with stock). These tests pin the fix and that nothing else about packaging changed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../offline/syncEngine";
import type { PharmacyPackaging, Product, Sale, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { buildSalePushPayload } from "../offline/cloudSync";
import { mergeProductFromCloudPull } from "./inventoryIntegrity";
import { decodeSaleLineFromCloud, type CloudSaleLineRow } from "./saleLineCloudCodec";
import { appendBatchToProduct, computeBatchIntegrity, createBatchOnReceive, getProductBatches } from "./pharmacyBatches";
import { buildPharmacySaleLine, detectPharmacySaleUnit, getPharmacyPackagingSellPresets, isPharmacyPackagingActive, normalizePharmacyPackaging, stockPackagingBreakdown, stripPriceForProduct } from "./pharmacyPackaging";

const PID = "ffffffff-2222-4fff-8fff-ffffffffffff";
const T0 = "2026-09-01T00:00:00.000Z";
const T_LOCAL = "2026-09-10T10:00:00.000Z";
const T_SERVER = "2026-09-10T10:00:05.000Z"; // the server re-stamps updated_at on every write: always later
const st = () => usePosStore.getState();

function baseProduct(over: Partial<Product> = {}): Product {
  return { id: PID, name: "Amoxicillin", sellingMode: "unit", baseUnit: "capsule", sellingPricePerUnitUgx: 500, costPricePerUnitUgx: 200, stockOnHand: 150, minimumStockAlert: 5, category: "Rx", sku: "", updatedAt: T0, version: 1, pharmacyMaster: { batchTracked: true, expiryTracked: true, otcOrPrescription: "otc" }, ...over };
}
const receive = (p: Product, batchNumber: string, expiry: string, qty: number) => appendBatchToProduct(p, createBatchOnReceive({ batchNumber, expiryDate: expiry, quantityBase: qty, unitCostUgx: 200, at: T0 }));
/** A batch-tracked product WITHOUT packaging levels: appendBatchToProduct creates `enabled: false` + the batches. */
function batchOnly(): Product {
  return { ...receive(receive(baseProduct(), "LOT-A", "2027-01-01", 100), "LOT-B", "2027-06-01", 50), stockOnHand: 150 };
}
const ENABLED_PKG: PharmacyPackaging = { enabled: true, baseUnit: "capsule", level1: { unit: "strip", containsBaseUnits: 10 }, level2: { unit: "box", containsLevel1Units: 10 }, sell: { tablet: true, strip: true, box: true }, priceStripUgx: 4_500, priceBoxUgx: 42_000, lowStockAlertUnit: "strip", batches: [] };
function withPackaging(): Product {
  let p = baseProduct({ pharmacyPackaging: { ...ENABLED_PKG, batches: [] } });
  p = receive(p, "LOT-A", "2027-01-01", 100);
  p = receive(p, "LOT-B", "2027-06-01", 50);
  return { ...p, stockOnHand: 150 };
}

/** What the cloud stores in products.metadata, read back the way rowToProduct reads it. */
function throughCloud(p: Product, over: Partial<Product> = {}): Product {
  const meta = JSON.parse(JSON.stringify({ pharmacyPackaging: p.pharmacyPackaging ?? null, pharmacyMaster: p.pharmacyMaster ?? null })) as { pharmacyPackaging: unknown };
  return { ...p, pharmacyPackaging: normalizePharmacyPackaging(meta.pharmacyPackaging), ...over };
}
const qty = (p: Product) => Object.fromEntries(getProductBatches(p).map((b) => [b.batchNumber, b.quantityRemaining]));

describe("the pull path is wired through the normalizer (what these tests stand in for)", () => {
  it("rowToProduct reads pharmacyPackaging through normalizePharmacyPackaging, and productToRow writes the whole object", () => {
    const src = readFileSync(join(process.cwd(), "src/offline/cloudSync.ts"), "utf8");
    expect(src).toContain("pharmacyPackaging: normalizePharmacyPackaging(meta.pharmacyPackaging)");
    expect(src).toContain("pharmacyPackaging: p.pharmacyPackaging ?? null");
    expect((src.match(/normalizePharmacyPackaging\(/g) ?? []).length).toBe(1); // the pull is its only caller
  });
});

describe("A. enabled=true + batches survives (unchanged)", () => {
  it("the batches and every selling-configuration field come back exactly", () => {
    const p = withPackaging();
    const back = throughCloud(p);
    expect(back.pharmacyPackaging!.enabled).toBe(true);
    expect(getProductBatches(back).map((b) => [b.id, b.batchNumber, b.quantityRemaining, b.expiryDate])).toEqual(getProductBatches(p).map((b) => [b.id, b.batchNumber, b.quantityRemaining, b.expiryDate]));
    const { batches: _b, ...config } = back.pharmacyPackaging!;
    void _b;
    expect(config).toEqual({ enabled: true, baseUnit: "capsule", level1: { unit: "strip", containsBaseUnits: 10 }, level2: { unit: "box", containsLevel1Units: 10 }, sell: { tablet: true, strip: true, box: true }, priceStripUgx: 4_500, priceBoxUgx: 42_000, lowStockAlertUnit: "strip" });
  });
  it("enabled=true with no batches key or a non-array reads as before (empty batches)", () => {
    expect(normalizePharmacyPackaging({ enabled: true, baseUnit: "tablet" })!.batches).toEqual([]);
    expect(normalizePharmacyPackaging({ enabled: true, batches: "nope" })!.batches).toEqual([]);
  });
});

describe("B. enabled=false + batches survives (the R11 fix)", () => {
  it("the product built by appendBatchToProduct really is enabled=false with two batches", () => {
    const p = batchOnly();
    expect(p.pharmacyPackaging!.enabled).toBe(false);
    expect(getProductBatches(p)).toHaveLength(2);
  });
  it("both batches come back intact, and the flag stays false", () => {
    const p = batchOnly();
    const back = throughCloud(p);
    expect(back.pharmacyPackaging).not.toBeNull();
    expect(back.pharmacyPackaging!.enabled).toBe(false);
    expect(getProductBatches(back)).toHaveLength(2);
    expect(getProductBatches(back).map((b) => [b.id, b.batchNumber, b.expiryDate, b.quantityReceived, b.quantityRemaining, b.unitCostUgx, b.status, b.timeline.length])).toEqual(
      getProductBatches(p).map((b) => [b.id, b.batchNumber, b.expiryDate, b.quantityReceived, b.quantityRemaining, b.unitCostUgx, b.status, b.timeline.length]),
    );
  });
  it("the selling configuration stays INACTIVE: every consumer still sees packaging as off", () => {
    const back = throughCloud(batchOnly());
    expect(isPharmacyPackagingActive(back)).toBe(false);
    expect(stripPriceForProduct(back)).toBeNull();
    expect(getPharmacyPackagingSellPresets(back)).toEqual([]);
    expect(stockPackagingBreakdown(back)).toBeNull();
    expect(detectPharmacySaleUnit(back, 10)).toBe("tablet");
    expect(buildPharmacySaleLine(back, "strip", 1).error).toBe("noPackaging");
  });
  it("residual configuration on a disabled object is still inert", () => {
    const p = withPackaging();
    const disabled = throughCloud({ ...p, pharmacyPackaging: { ...p.pharmacyPackaging!, enabled: false } });
    expect(disabled.pharmacyPackaging!.enabled).toBe(false);
    expect(getProductBatches(disabled)).toHaveLength(2);
    expect(isPharmacyPackagingActive(disabled)).toBe(false);
    expect(stripPriceForProduct(disabled)).toBeNull();
    expect(getPharmacyPackagingSellPresets(disabled)).toEqual([]);
  });
});

describe("C. enabled=false with no batches stays as before (null, valid)", () => {
  it.each([
    ["an empty batch list", { enabled: false, baseUnit: "capsule", batches: [] }],
    ["no batch key", { enabled: false, baseUnit: "capsule" }],
    ["a non-array batch value", { enabled: false, batches: "x" }],
    ["only malformed batches", { enabled: false, batches: [null, 42, {}, { batchNumber: "no id" }] }],
    ["enabled missing entirely", { baseUnit: "capsule", batches: [] }],
  ])("%s -> null", (_n, raw) => {
    expect(normalizePharmacyPackaging(raw)).toBeNull();
  });
  it("a product whose packaging reads as null is still valid: no batches, integrity ok", () => {
    const p = { ...baseProduct(), pharmacyPackaging: normalizePharmacyPackaging({ enabled: false, batches: [] }) };
    expect(getProductBatches(p)).toEqual([]);
    expect(computeBatchIntegrity(p)).toMatchObject({ ok: true, batchSum: 0 });
  });
});

describe("D. no pharmacyPackaging stays no pharmacyPackaging", () => {
  it.each([[undefined], [null], ["x"], [42], [true]])("%s -> null", (raw) => {
    expect(normalizePharmacyPackaging(raw)).toBeNull();
  });
  it("a product without packaging round-trips to a product without packaging", () => {
    expect(throughCloud(baseProduct()).pharmacyPackaging).toBeNull();
  });
});

describe("E. a pull of an enabled=false product does not erase its local batches", () => {
  it("the device's own row read back after a stock change keeps LOT-A and LOT-B", () => {
    const local = { ...batchOnly(), updatedAt: T_LOCAL };
    const remote = throughCloud(local, { updatedAt: T_SERVER }); // the row the server stamped later, read back through the normalizer
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect(qty(merged)).toEqual({ "LOT-A": 100, "LOT-B": 50 });
    expect(merged.pharmacyPackaging!.enabled).toBe(false);
  });
  it("the same holds with a pending local catalog edit", () => {
    const local = { ...batchOnly(), updatedAt: T_LOCAL };
    const merged = mergeProductFromCloudPull(local, throughCloud(local, { updatedAt: T_SERVER }), { pendingLocalCatalog: true });
    expect(qty(merged)).toEqual({ "LOT-A": 100, "LOT-B": 50 });
  });
  it("a first-time pull onto a device that has no copy yet receives the batches too", () => {
    const remote = throughCloud(batchOnly(), { updatedAt: T_SERVER });
    expect(getProductBatches(remote)).toHaveLength(2);
    expect(computeBatchIntegrity(remote)).toMatchObject({ ok: true, stockOnHand: 150, batchSum: 150 });
  });
});

describe("F. every other product field still merges exactly as before", () => {
  it("name, price, category and the rest follow the same rules; only the batches were being lost", () => {
    const local = { ...batchOnly(), updatedAt: T_LOCAL };
    const remote = throughCloud({ ...local, name: "Amoxicillin 500mg", sellingPricePerUnitUgx: 650, category: "Antibiotics", sku: "AMX-500", version: 2 }, { updatedAt: T_SERVER });
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect([merged.name, merged.sellingPricePerUnitUgx, merged.category, merged.sku, merged.version, merged.updatedAt]).toEqual(["Amoxicillin 500mg", 650, "Antibiotics", "AMX-500", 2, T_SERVER]);
    expect(qty(merged)).toEqual({ "LOT-A": 100, "LOT-B": 50 });
  });
  it("a product with packaging enabled merges exactly as before", () => {
    const local = { ...withPackaging(), updatedAt: T_LOCAL };
    const merged = mergeProductFromCloudPull(local, throughCloud({ ...local, name: "Renamed" }, { updatedAt: T_SERVER }), {});
    expect(merged.name).toBe("Renamed");
    expect(merged.pharmacyPackaging).toEqual(throughCloud(local).pharmacyPackaging);
  });
});

describe("G. stockOnHand is untouched", () => {
  it("normalizing changes no stock, and the merge still takes stock from the server row alone", () => {
    const local = { ...batchOnly(), stockOnHand: 130, updatedAt: T_LOCAL };
    const remote = throughCloud(local, { stockOnHand: 120, updatedAt: T_SERVER });
    expect(remote.stockOnHand).toBe(120);
    expect(mergeProductFromCloudPull(local, remote, {}).stockOnHand).toBe(120);
    expect(mergeProductFromCloudPull(local, remote, { pendingLocalRestock: true }).stockOnHand).toBe(130);
    expect(local.stockOnHand).toBe(130);
  });
});

describe("H. batch integrity sees the batches", () => {
  it("after a pull the batch sum is real (before the fix it silently read 0 and still said ok)", () => {
    const back = throughCloud(batchOnly());
    const integrity = computeBatchIntegrity(back);
    expect(integrity.batches).toHaveLength(2);
    expect(integrity).toMatchObject({ ok: true, stockOnHand: 150, batchSum: 150, delta: 0, batchTracked: true });
  });
  it("and it still reports real drift when the quantities disagree", () => {
    const back = throughCloud({ ...batchOnly(), stockOnHand: 130 });
    expect(computeBatchIntegrity(back)).toMatchObject({ ok: false, batchSum: 150, delta: -20 });
  });
});

describe("I. F3 provenance still resolves its batch after the pull", () => {
  beforeEach(() => {
    vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function seed(products: Product[], sales: Sale[]) {
    usePosStore.setState({
      _hydrated: true, sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" }, products, customers: [], sales, stockMovements: [], archivedStockMovements: [], voidRecords: [],
      archivedVoidRecords: [], returnRecords: [], archivedReturnRecords: [], auditLogs: [], draftLines: [], draftCartDiscountUgx: 0, activePendingSaleId: null, draftInput: null, draftPaymentMethod: "cash",
      pharmacyPrescriptions: [], pharmacyControlledRegister: [], preferences: { ...st().preferences, businessType: "pharmacy", pharmacyModeEnabled: true },
    });
    expect(openTestShift().ok).toBe(true);
  }
  const line = (qtyN: number): SaleLine => ({ id: "cccccccc-0000-4000-8000-000000000001", productId: PID, name: "Amoxicillin", inputMode: "quantity", quantity: qtyN, unitPriceUgx: 500, unitCostUgx: 200, lineTotalUgx: 500 * qtyN, estimatedProfitUgx: 300 * qtyN, updatedAt: T0 });

  it("Device B (product pulled from the cloud, sale pulled through the F3 codec) voids and the right batch is restored", () => {
    // Device A dispenses 20 from LOT-A (real finalize), then its product travels through the cloud
    seed([batchOnly()], []);
    usePosStore.setState({ draftLines: [line(20)] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash", amountPaidUgx: 10_000 }).ok).toBe(true);
    const saleA = st().sales[0]!;
    const productA = st().products[0]!;
    expect(qty(productA)).toEqual({ "LOT-A": 80, "LOT-B": 50 });
    const productB = throughCloud(productA, { updatedAt: T_SERVER });
    expect(qty(productB)).toEqual({ "LOT-A": 80, "LOT-B": 50 }); // R11: used to be {} here
    const rows = buildSalePushPayload(saleA, { shopId: "s", userId: "u" }).lines.map((l) => JSON.parse(JSON.stringify(l)) as CloudSaleLineRow);
    const saleB: Sale = { ...saleA, pendingSync: false, lines: rows.map((r) => decodeSaleLineFromCloud(r)) };
    expect(saleB.lines[0]!.pharmacyBatchNumber).toBe("LOT-A");
    seed([productB], [saleB]);
    expect(st().voidSaleLine({ saleId: saleA.id, lineIndex: 0, reason: "other", note: "B" }).ok).toBe(true);
    expect(st().products[0]!.stockOnHand).toBe(150);
    expect(qty(st().products[0]!)).toEqual({ "LOT-A": 100, "LOT-B": 50 });
    expect(computeBatchIntegrity(st().products[0]!).ok).toBe(true);
  });
});

describe("J. legacy products are unaffected", () => {
  it("a retail product without any pharmacy fields merges exactly as before", () => {
    const retail: Product = { id: "coke", name: "Coke", sellingMode: "unit", baseUnit: "bottle", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 10, minimumStockAlert: 0, category: "Drinks", sku: "", updatedAt: T_LOCAL, version: 1 };
    const remote = { ...retail, name: "Coca-Cola", sellingPricePerUnitUgx: 2_500, stockOnHand: 8, updatedAt: T_SERVER, version: 2 };
    const merged = mergeProductFromCloudPull(retail, remote, {});
    expect([merged.name, merged.sellingPricePerUnitUgx, merged.stockOnHand, merged.version]).toEqual(["Coca-Cola", 2_500, 8, 2]);
    expect(merged.pharmacyPackaging ?? null).toBeNull();
  });
  it("a legacy batch record (quantityBase only, no timeline) inside a disabled object is read as it always was and kept", () => {
    const back = normalizePharmacyPackaging({ enabled: false, baseUnit: "tablet", batches: [{ id: "legacy-1", batchNumber: "OLD-1", expiryDate: "2027-03-01", quantityBase: 40, unitCostUgx: 25 }] });
    expect(back).not.toBeNull();
    const [b] = back!.batches!;
    expect([b!.id, b!.batchNumber, b!.quantityReceived, b!.quantityRemaining, b!.unitCostUgx, b!.status]).toEqual(["legacy-1", "OLD-1", 40, 40, 25, "active"]);
  });
  it("the enabled=true reading is byte-for-byte what it was (fixed expectation)", () => {
    const raw = { enabled: true, baseUnit: "tablet", level1: { unit: "strip", containsBaseUnits: 10 }, level2: null, sell: { strip: true }, priceStripUgx: 3_000, priceBoxUgx: null, lowStockAlertUnit: "strip", batches: [] };
    expect(normalizePharmacyPackaging(raw)).toEqual({ enabled: true, baseUnit: "tablet", level1: { unit: "strip", containsBaseUnits: 10 }, level2: null, sell: { tablet: true, strip: true, box: false }, priceStripUgx: 3_000, priceBoxUgx: null, lowStockAlertUnit: "strip", batches: [] });
  });
});
