/**
 * Server reporting payload simulation (run: node scripts/reporting-stress.mjs)
 */

function makeSale(i) {
  const createdAt = new Date(Date.now() - (i + 90) * 86_400_000).toISOString();
  return {
    id: `sale-${i}`,
    createdAt,
    totalUgx: 1000 + (i % 50) * 100,
    cashPaidUgx: 800,
    debtUgx: 200,
    lines: [{ productId: `p-${i % 500}`, name: `Item ${i % 500}`, quantity: 1, lineTotalUgx: 1000 }],
  };
}

function aggregateDaily(sales, dayKey) {
  const daySales = sales.filter((s) => s.createdAt.slice(0, 10) <= dayKey);
  return {
    transaction_count: daySales.length,
    total_revenue_ugx: daySales.reduce((a, s) => a + s.totalUgx, 0),
  };
}

function fullClientScan(sales) {
  const t0 = performance.now();
  let revenue = 0;
  for (const s of sales) revenue += s.totalUgx;
  const payload = JSON.stringify(sales);
  return { ms: performance.now() - t0, bytes: payload.length, revenue };
}

function serverSummaryOnly(sales) {
  const t0 = performance.now();
  const summary = {
    transaction_count: sales.length,
    total_revenue_ugx: sales.reduce((a, s) => a + s.totalUgx, 0),
    top_products: [],
  };
  for (let i = 0; i < 500; i++) {
    const pid = `p-${i}`;
    summary.top_products.push({ product_id: pid, name: `Item ${i}`, revenue_ugx: 1000 * (i % 7) });
  }
  const bytes = JSON.stringify(summary).length;
  return { ms: performance.now() - t0, bytes, summary };
}

console.log("Waka POS server reporting stress harness\n");

for (const n of [100, 10_000, 100_000]) {
  const sales = Array.from({ length: n }, (_, i) => makeSale(i));
  const full = fullClientScan(sales);
  const server = serverSummaryOnly(sales);
  const saved = full.bytes > 0 ? (((full.bytes - server.bytes) / full.bytes) * 100).toFixed(1) : "0";
  console.log(`--- ${n.toLocaleString()} sales ---`);
  console.log(`  Full client download: ${(full.bytes / 1024 / 1024).toFixed(2)} MB · ${full.ms.toFixed(1)}ms parse`);
  console.log(`  Server summary only:  ${(server.bytes / 1024).toFixed(1)} KB · ${server.ms.toFixed(2)}ms`);
  console.log(`  Payload reduction:    ~${saved}%`);
}

console.log("\nReporting stress harness complete.");
