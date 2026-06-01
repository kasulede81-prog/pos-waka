/**
 * Hospitality concurrency verification (P0).
 * Run: npm run verify:hospitality-concurrency
 *
 * Covers Beer+Pork merge, offline/online union, merge/transfer line preservation,
 * duplicate tab line ids, and settlement guard expectations.
 */

import { execSync } from "node:child_process";

console.log("=== Hospitality Concurrency Verification (P0) ===\n");

try {
  execSync("npx vitest run src/lib/pendingSaleMerge.test.ts", { stdio: "inherit" });
  console.log("\nPASS: hospitality concurrency unit tests");
  process.exit(0);
} catch {
  console.error("\nFAIL: hospitality concurrency tests");
  process.exit(1);
}
