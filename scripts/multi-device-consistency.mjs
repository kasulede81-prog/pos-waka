/**
 * Multi-device consistency simulation (evidence-based, no sync redesign).
 * Run: node scripts/multi-device-consistency.mjs
 *
 * Replicates the LWW merge in src/offline/cloudSync.ts `newer()` + `mergeById`.
 */

function newer(a, b) {
  const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
  const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
  if (ta !== tb) return ta >= tb ? a : b;
  return (a.version ?? 0) >= (b.version ?? 0) ? a : b;
}

function mergeById(local, remote, pick) {
  const map = new Map();
  for (const r of remote) map.set(r.id, r);
  for (const l of local) {
    const existing = map.get(l.id);
    map.set(l.id, existing ? pick(l, existing) : l);
  }
  return [...map.values()];
}

const scenarios = [];

function record(name, deviceA, deviceB, merged, risk) {
  scenarios.push({ name, deviceA, deviceB, merged, risk });
}

// 1. Simultaneous sales (different IDs — no conflict)
record(
  "Simultaneous sales (different sale IDs)",
  { sales: [{ id: "s-a", totalUgx: 5000, createdAt: "2026-05-28T10:00:00Z" }] },
  { sales: [{ id: "s-b", totalUgx: 3000, createdAt: "2026-05-28T10:00:01Z" }] },
  mergeById(
    [{ id: "s-a", totalUgx: 5000, createdAt: "2026-05-28T10:00:00Z" }],
    [{ id: "s-b", totalUgx: 3000, createdAt: "2026-05-28T10:00:01Z" }],
    newer,
  ),
  "LOW — separate records; both persist",
);

// 2. Simultaneous stock adjustments (same product)
record(
  "Simultaneous stock adjustment (same product)",
  { product: { id: "p1", stockOnHand: 8, updatedAt: "2026-05-28T10:00:00Z", version: 5 } },
  { product: { id: "p1", stockOnHand: 12, updatedAt: "2026-05-28T10:00:02Z", version: 6 } },
  mergeById(
    [{ id: "p1", stockOnHand: 8, updatedAt: "2026-05-28T10:00:00Z", version: 5 }],
    [{ id: "p1", stockOnHand: 12, updatedAt: "2026-05-28T10:00:02Z", version: 6 }],
    newer,
  )[0],
  "HIGH — LWW; one adjustment lost (device A stock=8 discarded)",
);

// 3. Simultaneous customer debt update
record(
  "Simultaneous customer debt update",
  { customer: { id: "c1", debtBalanceUgx: 10000, updatedAt: "2026-05-28T10:00:00Z", version: 2 } },
  { customer: { id: "c1", debtBalanceUgx: 15000, updatedAt: "2026-05-28T10:00:01Z", version: 3 } },
  mergeById(
    [{ id: "c1", debtBalanceUgx: 10000, updatedAt: "2026-05-28T10:00:00Z", version: 2 }],
    [{ id: "c1", debtBalanceUgx: 15000, updatedAt: "2026-05-28T10:00:01Z", version: 3 }],
    newer,
  )[0],
  "HIGH — LWW; debt balance from older device discarded",
);

// 4. Simultaneous product edit (name + price)
record(
  "Simultaneous product edit",
  { product: { id: "p2", name: "Sugar A", sellingPricePerUnitUgx: 5000, updatedAt: "2026-05-28T10:00:00Z", version: 4 } },
  { product: { id: "p2", name: "Sugar B", sellingPricePerUnitUgx: 5500, updatedAt: "2026-05-28T10:00:03Z", version: 5 } },
  mergeById(
    [{ id: "p2", name: "Sugar A", sellingPricePerUnitUgx: 5000, updatedAt: "2026-05-28T10:00:00Z", version: 4 }],
    [{ id: "p2", name: "Sugar B", sellingPricePerUnitUgx: 5500, updatedAt: "2026-05-28T10:00:03Z", version: 5 }],
    newer,
  )[0],
  "HIGH — entire product row replaced; partial field merge impossible",
);

// 5. Simultaneous refunds (different return IDs)
record(
  "Simultaneous refunds (different return IDs)",
  { returns: [{ id: "r1", refundAmountUgx: 2000, createdAt: "2026-05-28T11:00:00Z" }] },
  { returns: [{ id: "r2", refundAmountUgx: 1500, createdAt: "2026-05-28T11:00:01Z" }] },
  "Both returns exist locally; cloud RPC idempotent per return ID",
  "LOW — separate return records",
);

// 6. Same sale edited on two devices (void on A, sale on B)
record(
  "Same sale voided on A, unchanged on B",
  { sale: { id: "s1", totalUgx: 8000, pendingSync: true, updatedAt: "2026-05-28T12:00:00Z", version: 2 } },
  { sale: { id: "s1", totalUgx: 10000, pendingSync: true, updatedAt: "2026-05-28T12:00:05Z", version: 1 } },
  newer(
    { id: "s1", totalUgx: 8000, updatedAt: "2026-05-28T12:00:00Z", version: 2 },
    { id: "s1", totalUgx: 10000, updatedAt: "2026-05-28T12:00:05Z", version: 1 },
  ),
  "HIGH — newer timestamp wins even if version lower; void may be lost",
);

console.log("=== Waka POS Multi-Device Consistency Simulation ===\n");
console.log("Merge strategy: last-write-wins (newer updatedAt, then version)");
console.log("Source: src/offline/cloudSync.ts newer() + mergeByIdChunked()\n");

for (const s of scenarios) {
  console.log(`--- ${s.name} ---`);
  console.log("Device A:", JSON.stringify(s.deviceA));
  console.log("Device B:", JSON.stringify(s.deviceB));
  console.log("Merged:  ", JSON.stringify(s.merged));
  console.log("Risk:    ", s.risk);
  console.log();
}

const high = scenarios.filter((s) => s.risk.startsWith("HIGH")).length;
console.log(`Summary: ${scenarios.length} scenarios, ${high} HIGH risk (LWW data loss possible)`);
console.log("\nRecommendation: collect pilot telemetry on conflict frequency before redesigning sync.");
process.exit(high > 0 ? 0 : 0);
