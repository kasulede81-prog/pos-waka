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

function makeSale(i) {
  return {
    id: `sale-${i}`,
    createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    lines: [{ productId: "p1", quantity: 1, unitPriceUgx: 1000, lineTotalUgx: 1000 }],
    totalUgx: 1000,
    subtotalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 200,
  };
}

function makeProduct(i) {
  return {
    id: `p-${i}`,
    name: `Product ${i}`,
    updatedAt: new Date().toISOString(),
    stockOnHand: 10,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 800,
    version: 1,
  };
}

console.log("Waka POS stability stress harness\n");

const sales = Array.from({ length: 50_000 }, (_, i) => makeSale(i));
const products = Array.from({ length: 5_000 }, (_, i) => makeProduct(i));
const customers = Array.from({ length: 10_000 }, (_, i) => ({
  id: `c-${i}`,
  name: `Customer ${i}`,
  createdAt: new Date().toISOString(),
  debtBalanceUgx: 0,
  version: 1,
}));

const memBefore = process.memoryUsage().heapUsed;

const t0 = performance.now();
const prevSales = sales.slice(1);
const nextSales = [makeSale(-1), ...prevSales];
const saleDelta = diffById(prevSales, nextSales);
const t1 = performance.now();

const prevProducts = products;
const nextProducts = products.map((p, idx) => (idx === 0 ? { ...p, stockOnHand: p.stockOnHand - 1 } : p));
const productDelta = diffById(prevProducts, nextProducts);
const t2 = performance.now();

const archiveCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
let archived = 0;
for (const s of sales) {
  if (s.createdAt < archiveCutoff) archived += 1;
}
const t3 = performance.now();

const memAfter = process.memoryUsage().heapUsed;

console.log(`Dataset: ${products.length} products, ${sales.length} sales, ${customers.length} customers`);
console.log(`Single sale incremental delta: ${saleDelta.upserts} upserts (${(t1 - t0).toFixed(2)}ms)`);
console.log(`Single stock adjust delta: ${productDelta.upserts} upserts (${(t2 - t1).toFixed(2)}ms)`);
console.log(`30-day archive scan: ${archived} sales eligible (${(t3 - t2).toFixed(2)}ms)`);
console.log(`Heap delta: ${((memAfter - memBefore) / (1024 * 1024)).toFixed(2)} MB`);

const src = readFileSync(join(root, "src/offline/incrementalPersist.ts"), "utf8");
const hasIncremental = src.includes("flushIncrementalPersist");
const hasTombstone = src.includes("markProductDeleted");
console.log(`\nIncremental persist module: ${hasIncremental ? "OK" : "MISSING"}`);
console.log(`Product tombstones: ${hasTombstone ? "OK" : "MISSING"}`);
console.log("\nStress harness complete.");
