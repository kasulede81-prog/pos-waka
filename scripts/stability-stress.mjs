/**
 * Production stability stress harness (run: node scripts/stability-stress.mjs)
 * Simulates incremental persist delta computation without IndexedDB.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function diffById(prev, next) {
  const prevMap = new Map(prev.map((x) => [x.id, x]));
  const nextMap = new Map(next.map((x) => [x.id, x]));
  let upserts = 0;
  for (const row of next) {
    if (prevMap.get(row.id) !== row) upserts += 1;
  }
  let removed = 0;
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removed += 1;
  }
  return { upserts, removed };
}

function makeSale(i, bumpUpdated = false) {
  const createdAt = new Date(Date.now() - (i + 90) * 86_400_000).toISOString();
  return {
    id: `sale-${i}`,
    createdAt,
    updatedAt: bumpUpdated ? new Date().toISOString() : createdAt,
    lines: [{ productId: "p1", quantity: 1, unitPriceUgx: 1000, lineTotalUgx: 1000 }],
    totalUgx: 1000,
    subtotalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 200,
  };
}

function simulateFullPull(rows) {
  const t0 = performance.now();
  const payload = JSON.stringify(rows);
  const bytes = payload.length;
  const t1 = performance.now();
  return { count: rows.length, bytes, ms: t1 - t0 };
}

function simulateIncrementalPull(rows, sinceIso) {
  const since = new Date(sinceIso).getTime();
  const t0 = performance.now();
  const changed = rows.filter((r) => new Date(r.updatedAt ?? r.createdAt).getTime() > since);
  const payload = JSON.stringify(changed);
  const bytes = payload.length;
  const t1 = performance.now();
  return { count: changed.length, bytes, ms: t1 - t0 };
}

function makeProduct(i) {
  const old = new Date(Date.now() - 7 * 86400000).toISOString();
  return {
    id: `p-${i}`,
    name: `Product ${i}`,
    updatedAt: old,
    stockOnHand: 10,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 800,
    version: 1,
  };
}

console.log("Waka POS stability stress harness\n");

const sales100k = Array.from({ length: 100_000 }, (_, i) => makeSale(i));
const sales50k = sales100k.slice(0, 50_000);
const products = Array.from({ length: 10_000 }, (_, i) => makeProduct(i));
const customers = Array.from({ length: 20_000 }, (_, i) => ({
  id: `c-${i}`,
  name: `Customer ${i}`,
  createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  debtBalanceUgx: 0,
  version: 1,
}));

const memBefore = process.memoryUsage().heapUsed;

const t0 = performance.now();
const prevSales = sales50k.slice(1);
const nextSales = [makeSale(-1), ...prevSales];
const saleDelta = diffById(prevSales, nextSales);
const t1 = performance.now();

const prevProducts = products;
const nextProducts = products.map((p, idx) => (idx === 0 ? { ...p, stockOnHand: p.stockOnHand - 1 } : p));
const productDelta = diffById(prevProducts, nextProducts);
const t2 = performance.now();

const archiveCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
let archived = 0;
for (const s of sales50k) {
  if (s.createdAt < archiveCutoff) archived += 1;
}
const t3 = performance.now();

const lastSyncAt = new Date(Date.now() - 86_400_000).toISOString();
sales100k[0] = makeSale(0, true);
sales100k[1] = makeSale(1, true);
const fullSalesPull = simulateFullPull(sales100k);
const incrSalesPull = simulateIncrementalPull(sales100k, lastSyncAt);
const fullProductsPull = simulateFullPull(products);
const incrProductsPull = simulateIncrementalPull(
  products.map((p, idx) => (idx < 3 ? { ...p, updatedAt: new Date().toISOString() } : p)),
  lastSyncAt,
);
const fullCustomersPull = simulateFullPull(customers);
const incrCustomersPull = simulateIncrementalPull(
  customers.map((c, idx) => (idx === 0 ? { ...c, updatedAt: new Date().toISOString() } : c)),
  lastSyncAt,
);
const t4 = performance.now();

const memAfter = process.memoryUsage().heapUsed;

console.log(`Dataset: ${products.length} products, ${sales100k.length} sales, ${customers.length} customers`);
console.log(`Single sale incremental delta: ${saleDelta.upserts} upserts (${(t1 - t0).toFixed(2)}ms)`);
console.log(`Single stock adjust delta: ${productDelta.upserts} upserts (${(t2 - t1).toFixed(2)}ms)`);
console.log(`30-day archive scan: ${archived} sales eligible (${(t3 - t2).toFixed(2)}ms)`);
console.log(`Heap delta: ${((memAfter - memBefore) / (1024 * 1024)).toFixed(2)} MB`);
console.log("\n--- Incremental cloud sync simulation (100k sales shop) ---");
console.log(
  `Sales full: ${fullSalesPull.count} rows, ${(fullSalesPull.bytes / 1024 / 1024).toFixed(2)} MB, ${fullSalesPull.ms.toFixed(2)}ms`,
);
console.log(
  `Sales incremental (2 changed): ${incrSalesPull.count} rows, ${(incrSalesPull.bytes / 1024).toFixed(1)} KB, ${incrSalesPull.ms.toFixed(2)}ms`,
);
console.log(
  `Products full: ${fullProductsPull.count} rows, ${(fullProductsPull.bytes / 1024).toFixed(0)} KB vs incr ${incrProductsPull.count} rows, ${(incrProductsPull.bytes / 1024).toFixed(1)} KB`,
);
console.log(
  `Customers full: ${fullCustomersPull.count} rows, ${(fullCustomersPull.bytes / 1024).toFixed(0)} KB vs incr ${incrCustomersPull.count} rows, ${(incrCustomersPull.bytes / 1024).toFixed(1)} KB`,
);
const bandwidthSavedPct =
  fullSalesPull.bytes > 0
    ? (((fullSalesPull.bytes - incrSalesPull.bytes) / fullSalesPull.bytes) * 100).toFixed(1)
    : "0";
console.log(`Estimated daily sales sync bandwidth savings: ~${bandwidthSavedPct}%`);
console.log(`Cloud sync simulation total: ${(t4 - t3).toFixed(2)}ms`);

const src = readFileSync(join(root, "src/offline/incrementalPersist.ts"), "utf8");
const cloudSrc = readFileSync(join(root, "src/offline/cloudSync.ts"), "utf8");
const hasIncremental = src.includes("flushIncrementalPersist");
const hasTombstone = src.includes("markProductDeleted");
const hasIncrementalPull = cloudSrc.includes("pullSalesIncremental") && cloudSrc.includes("lastSalesSyncAt");
console.log(`\nIncremental persist module: ${hasIncremental ? "OK" : "MISSING"}`);
console.log(`Product tombstones: ${hasTombstone ? "OK" : "MISSING"}`);
console.log(`Incremental cloud pull: ${hasIncrementalPull ? "OK" : "MISSING"}`);
console.log("\nStress harness complete.");
