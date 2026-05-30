/**
 * Android soak test harness — automated simulation + manual checklist.
 * Run: node scripts/android-soak-harness.mjs [--minutes=30]
 *
 * This script simulates POS operations in-process (no real Android device).
 * For production sign-off, combine with manual 4h/8h device soak using the checklist below.
 */

const minutes = Number(process.argv.find((a) => a.startsWith("--minutes="))?.split("=")[1] ?? 5);
const durationMs = minutes * 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const started = Date.now();

const metrics = {
  sales: 0,
  returns: 0,
  productUpdates: 0,
  debtUpdates: 0,
  syncFlushes: 0,
  queuePeak: 0,
  errors: 0,
  longTasksMs: 0,
};

function simulateSale(i) {
  metrics.sales += 1;
  const t0 = performance.now();
  const lines = [{ qty: 1 + (i % 3), price: 1000 + (i % 500) }];
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const elapsed = performance.now() - t0;
  if (elapsed > 50) metrics.longTasksMs += elapsed;
  return { id: `sale-${i}`, totalUgx: total, pendingSync: true };
}

function simulateReturn(i) {
  metrics.returns += 1;
  return { id: `ret-${i}`, refundAmountUgx: 500 + (i % 200), quantity: 1 };
}

function simulateProductUpdate(i) {
  metrics.productUpdates += 1;
  return { id: `p-${i % 20}`, stockOnHand: 100 - (i % 50), version: i };
}

function simulateDebtUpdate(i) {
  metrics.debtUpdates += 1;
  return { id: `c-${i % 10}`, debtBalanceUgx: (i * 100) % 50000, version: i };
}

function simulateSyncQueue(batch) {
  metrics.syncFlushes += 1;
  metrics.queuePeak = Math.max(metrics.queuePeak, batch);
}

let i = 0;
while (Date.now() - started < durationMs) {
  try {
    simulateSale(i);
    if (i % 7 === 0) simulateReturn(i);
    if (i % 5 === 0) simulateProductUpdate(i);
    if (i % 11 === 0) simulateDebtUpdate(i);
    if (i % 3 === 0) simulateSyncQueue(Math.max(0, (i % 15) - 5));
    i += 1;
    if (i % 20 === 0) await sleep(100);
  } catch {
    metrics.errors += 1;
  }
}

const elapsedMin = ((Date.now() - started) / 60_000).toFixed(1);

console.log("=== Waka POS Android Soak Harness (simulated) ===\n");
console.log(`Duration: ${elapsedMin} minutes (requested ${minutes}m)`);
console.log(`Operations: ${i} cycles\n`);
console.log("Metrics:");
console.log(JSON.stringify(metrics, null, 2));
console.log("\n--- Manual Android soak checklist (required for production sign-off) ---");
console.log("[ ] 4h continuous: sales every 2–5 min on physical Android device");
console.log("[ ] 8h extended: include returns, product edits, debt recording");
console.log("[ ] Sleep/wake: 10 cycles during active sync");
console.log("[ ] Background/foreground: 20 app switches during checkout");
console.log("[ ] Offline 1h → reconnect: verify queue drains, no duplicates");
console.log("[ ] Poor network (3G throttle): verify no partial sales after RPC migration");
console.log("[ ] Monitor: SyncHealthCard pending count, stability diagnostics overlay");
console.log("[ ] Monitor: Sentry for crashes (VITE_SENTRY_DSN configured)");
console.log("\nEvidence: this harness proves simulation loop stability only.");
console.log("Real device memory/crash data requires manual execution + Sentry dashboard.");

process.exit(metrics.errors > 0 ? 1 : 0);
