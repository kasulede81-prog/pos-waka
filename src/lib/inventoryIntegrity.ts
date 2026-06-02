/**
 * Multi-device inventory merge, movement reconciliation, and integrity checks.
 */

import type { Product, Sale, StockMovement } from "../types";

/** Namespace UUID for deterministic sale movement ids (matches server inventory_movement_uuid). */
export const INVENTORY_MOVEMENT_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fdcb4fe";

export type StockDelta = {
  productId: string;
  delta: number;
  at: string;
  kind?: StockMovement["kind"];
  refId?: string | null;
};

export type ServerProductStockRow = {
  product_id: string;
  stock_on_hand: number;
  updated_at: string;
};

export type InventoryIntegrityMismatch = {
  productId: string;
  productName: string;
  recordedStock: number;
  expectedFromMovements: number;
  delta: number;
};

function recencyMs(updatedAt?: string, createdAt?: string): number {
  const u = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
  if (!Number.isNaN(u)) return u;
  const c = createdAt ? new Date(createdAt).getTime() : 0;
  return Number.isNaN(c) ? 0 : c;
}

/** RFC 4122 UUID v5 (deterministic) — mirrors Postgres inventory_movement_uuid. */
export function stableInventoryMovementId(
  shopKey: string,
  referenceType: string,
  referenceId: string,
  productId: string,
): string {
  const name = `${shopKey}|${referenceType}|${referenceId}|${productId}`;
  return uuidV5(INVENTORY_MOVEMENT_NAMESPACE, name);
}

function uuidV5(namespace: string, name: string): string {
  const nsBytes = parseUuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(nsBytes.length + nameBytes.length);
  data.set(nsBytes, 0);
  data.set(nameBytes, nsBytes.length);
  const hash = sha1Bytes(data);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return formatUuid(hash);
}

function parseUuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function formatUuid(bytes: Uint8Array): string {
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function sha1Bytes(data: Uint8Array): Uint8Array {
  // Minimal SHA-1 for UUID v5 (sync, no crypto.subtle dependency in tests)
  const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const ml = data.length * 8;
  const withLen = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  withLen.set(data);
  withLen[data.length] = 0x80;
  const view = new DataView(withLen.buffer);
  view.setUint32(withLen.length - 4, ml >>> 0, false);
  view.setUint32(withLen.length - 8, Math.floor(ml / 0x100000000), false);
  for (let off = 0; off < withLen.length; off += 64) {
    const w = new Int32Array(80);
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = K[0]!;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = K[1]!;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = K[2]!;
      } else {
        f = b ^ c ^ d;
        k = K[3]!;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, h0, false);
  dv.setInt32(4, h1, false);
  dv.setInt32(8, h2, false);
  dv.setInt32(12, h3, false);
  dv.setInt32(16, h4, false);
  return out;
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) | 0;
}

/**
 * Field-safe catalog merge: price/cost follow higher version; descriptive fields follow newer updatedAt.
 * Stock is never taken from this function — use mergeProductFromCloudPull for cloud sync.
 */
export function mergeProductCatalogFields(local: Product, remote: Product): Product {
  const localMs = recencyMs(local.updatedAt);
  const remoteMs = recencyMs(remote.updatedAt);
  const catalogBase = remoteMs >= localMs ? remote : local;
  const localVer = local.version ?? 1;
  const remoteVer = remote.version ?? 1;
  const priceCostSource = localVer > remoteVer ? local : remoteVer > localVer ? remote : catalogBase;

  const pickScalar = <K extends keyof Product>(field: K): Product[K] => {
    if (local[field] === remote[field]) return catalogBase[field];
    return localMs >= remoteMs ? local[field] : remote[field];
  };

  return {
    ...catalogBase,
    name: pickScalar("name"),
    category: pickScalar("category"),
    sku: pickScalar("sku"),
    baseUnit: pickScalar("baseUnit"),
    buyingUnit: pickScalar("buyingUnit"),
    conversionRate: pickScalar("conversionRate"),
    sellingMode: pickScalar("sellingMode"),
    minimumStockAlert: pickScalar("minimumStockAlert"),
    expiryDate: pickScalar("expiryDate"),
    medicineStrength: pickScalar("medicineStrength"),
    medicineForm: pickScalar("medicineForm"),
    quickPresetsMoneyUgx: pickScalar("quickPresetsMoneyUgx"),
    quickPresetsQty: pickScalar("quickPresetsQty"),
    sellingPricePerUnitUgx: priceCostSource.sellingPricePerUnitUgx,
    costPricePerUnitUgx: priceCostSource.costPricePerUnitUgx,
    version: Math.max(localVer, remoteVer, catalogBase.version ?? 1),
  };
}

/**
 * Cloud pull merge: server stock_on_hand is authoritative (movement ledger truth).
 */
export function mergeProductFromCloudPull(local: Product, remote: Product): Product {
  const catalog = mergeProductCatalogFields(local, remote);
  return {
    ...catalog,
    stockOnHand: remote.stockOnHand,
    updatedAt: remote.updatedAt,
  };
}

/** @deprecated Prefer mergeProductFromCloudPull during cloud sync. */
export function mergeProductInventory(local: Product, remote: Product): Product {
  return mergeProductFromCloudPull(local, remote);
}

/** Apply ordered stock deltas (floor at zero). */
export function applyStockDeltas(initialStock: number, deltas: StockDelta[]): number {
  let stock = initialStock;
  const ordered = [...deltas].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const d of ordered) {
    stock = Math.max(0, stock + d.delta);
  }
  return stock;
}

/** Whether a delta push would be rejected as stale (mirrors shop_push_product_stock). */
export function isStaleStockWrite(input: {
  serverStockOnHand: number;
  serverUpdatedAt: string;
  baseStockOnHand: number;
  baseUpdatedAt: string | null;
}): boolean {
  if (!input.baseUpdatedAt) return false;
  const serverMs = new Date(input.serverUpdatedAt).getTime();
  const baseMs = new Date(input.baseUpdatedAt).getTime();
  if (Number.isNaN(serverMs) || Number.isNaN(baseMs)) return false;
  if (serverMs <= baseMs) return false;
  return input.serverStockOnHand !== input.baseStockOnHand;
}

export function saleStockDeltasFromLines(
  saleId: string,
  lines: { productId: string; quantity: number; voided?: boolean }[],
  createdAt: string,
): StockDelta[] {
  const out: StockDelta[] = [];
  for (const line of lines) {
    if (line.voided) continue;
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (qty <= 0) continue;
    out.push({
      productId: line.productId,
      delta: -qty,
      at: createdAt,
      kind: "sale_out",
      refId: saleId,
    });
  }
  return out;
}

export function voidStockDelta(
  voidId: string,
  productId: string,
  quantity: number,
  createdAt: string,
): StockDelta {
  return {
    productId,
    delta: Math.max(0, quantity),
    at: createdAt,
    kind: "adjust_other",
    refId: voidId,
  };
}

export function returnStockDelta(
  returnId: string,
  productId: string,
  quantity: number,
  createdAt: string,
): StockDelta {
  return {
    productId,
    delta: Math.max(0, quantity),
    at: createdAt,
    kind: "adjust_other",
    refId: returnId,
  };
}

export function purchaseStockDeltasFromLines(
  purchaseId: string,
  lines: { productId: string; qtyBuyingUnits: number }[],
  baseUnitsPerLine: (productId: string, qtyBuyingUnits: number) => number,
  createdAt: string,
): StockDelta[] {
  return lines.map((ln) => ({
    productId: ln.productId,
    delta: Math.max(0, baseUnitsPerLine(ln.productId, ln.qtyBuyingUnits)),
    at: createdAt,
    kind: "purchase_in" as const,
    refId: purchaseId,
  }));
}

/** Idempotent sale movement rows for local ledger (stable ids). */
export function saleStockMovementsFromSale(
  shopKey: string,
  sale: Pick<Sale, "id" | "createdAt" | "lines">,
): StockMovement[] {
  const at = sale.createdAt;
  return sale.lines
    .filter((l) => !l.voided && l.quantity > 0)
    .map((line) => ({
      id: stableInventoryMovementId(shopKey, "sale", sale.id, line.productId),
      at,
      productId: line.productId,
      productName: line.name,
      deltaBaseUnits: -line.quantity,
      kind: "sale_out" as const,
      summary: `Sale −${line.quantity}`,
      refId: sale.id,
      supplierId: null,
    }));
}

/** Simulate two devices selling the same SKU against a shared movement ledger. */
export function simulateConcurrentDeviceSales(input: {
  initialStock: number;
  deviceASaleQty: number;
  deviceBSaleQty: number;
  deviceACompletedAt: string;
  deviceBCompletedAt: string;
  productId?: string;
  saleAId?: string;
  saleBId?: string;
}): { finalStock: number; deltas: StockDelta[] } {
  const productId = input.productId ?? "product-1";
  const deltas: StockDelta[] = [
    {
      productId,
      delta: -input.deviceASaleQty,
      at: input.deviceACompletedAt,
      kind: "sale_out",
      refId: input.saleAId ?? "sale-a",
    },
    {
      productId,
      delta: -input.deviceBSaleQty,
      at: input.deviceBCompletedAt,
      kind: "sale_out",
      refId: input.saleBId ?? "sale-b",
    },
  ];
  return {
    finalStock: applyStockDeltas(input.initialStock, deltas),
    deltas,
  };
}

/** Replay idempotent sale deductions (same sale id applied twice → one deduction). */
export function applyIdempotentSaleDeductions(
  initialStock: number,
  sales: { saleId: string; productId: string; quantity: number; at: string }[],
): number {
  const seen = new Set<string>();
  const deltas: StockDelta[] = [];
  const allAttempts = [...sales, ...sales];
  for (const s of allAttempts) {
    const key = `${s.saleId}:${s.productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deltas.push({
      productId: s.productId,
      delta: -s.quantity,
      at: s.at,
      kind: "sale_out",
      refId: s.saleId,
    });
  }
  return applyStockDeltas(initialStock, deltas);
}

export function movementsToDeltas(movements: StockMovement[]): StockDelta[] {
  return movements.map((m) => ({
    productId: m.productId,
    delta: m.deltaBaseUnits,
    at: m.at,
    kind: m.kind,
    refId: m.refId,
  }));
}

/**
 * Verify recorded stock vs movement ledger.
 * expected = opening + sum(deltas from movements)
 */
export function verifyInventoryIntegrity(input: {
  products: Product[];
  movements: StockMovement[];
  openingStockByProduct?: Record<string, number>;
}): { ok: boolean; mismatches: InventoryIntegrityMismatch[] } {
  const opening = input.openingStockByProduct ?? {};
  const deltasByProduct = new Map<string, number>();

  for (const m of input.movements) {
    const prev = deltasByProduct.get(m.productId) ?? 0;
    deltasByProduct.set(m.productId, prev + m.deltaBaseUnits);
  }

  const mismatches: InventoryIntegrityMismatch[] = [];
  for (const p of input.products) {
    if (!deltasByProduct.has(p.id) && opening[p.id] == null) continue;
    const base = opening[p.id] ?? 0;
    const deltaSum = deltasByProduct.get(p.id) ?? 0;
    const expected = Math.max(0, base + deltaSum);
    const recorded = p.stockOnHand;
    const diff = Math.abs(recorded - expected);
    if (diff > 0.0001) {
      mismatches.push({
        productId: p.id,
        productName: p.name,
        recordedStock: recorded,
        expectedFromMovements: expected,
        delta: recorded - expected,
      });
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Reconcile local stock from server rows after sale sync. */
export function patchProductsWithServerStock(
  products: Product[],
  rows: ServerProductStockRow[],
): Product[] {
  if (!rows.length) return products;
  const byId = new Map(rows.map((r) => [r.product_id, r]));
  return products.map((p) => {
    const row = byId.get(p.id);
    if (!row) return p;
    return {
      ...p,
      stockOnHand: Number(row.stock_on_hand),
      updatedAt: row.updated_at,
      version: p.version + 1,
    };
  });
}
