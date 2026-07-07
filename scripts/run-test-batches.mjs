#!/usr/bin/env node
/**
 * Run all Vitest files in batches to avoid worker hangs and produce aggregated JSON.
 * Usage: node scripts/run-test-batches.mjs [--batch-size=25]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const batchSize = Number(process.argv.find((a) => a.startsWith("--batch-size="))?.split("=")[1] ?? 30);

function walkTests(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTests(full, out);
    else if (name.endsWith(".test.ts")) out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const all = walkTests(path.join(root, "src")).sort();
const batches = [];
for (let i = 0; i < all.length; i += batchSize) batches.push(all.slice(i, i + batchSize));

console.log(`[waka-test-batches] files=${all.length} batches=${batches.length} batchSize=${batchSize}`);

const aggregate = {
  numTotalTestSuites: 0,
  numPassedTestSuites: 0,
  numFailedTestSuites: 0,
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  failures: [],
  slowSuites: [],
  batchDurations: [],
};

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  const outFile = path.join(root, `.test-batch-${i}.json`);
  const started = Date.now();
  console.log(`[waka-test-batches] batch ${i + 1}/${batches.length} (${batch.length} files)`);

  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      ...batch,
      "--reporter=json",
      `--outputFile=${outFile}`,
      "--pool=threads",
      "--maxWorkers=2",
      "--testTimeout=15000",
      "--hookTimeout=15000",
      "--no-file-parallelism",
    ],
    { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, CI: "1" } },
  );

  const elapsed = Date.now() - started;
  aggregate.batchDurations.push({ batch: i, files: batch.length, ms: elapsed, exitCode: result.status ?? 1 });

  try {
    const raw = JSON.parse(readFileSync(outFile, "utf8"));
    aggregate.numTotalTestSuites += raw.numTotalTestSuites ?? 0;
    aggregate.numPassedTestSuites += raw.numPassedTestSuites ?? 0;
    aggregate.numFailedTestSuites += raw.numFailedTestSuites ?? 0;
    aggregate.numTotalTests += raw.numTotalTests ?? 0;
    aggregate.numPassedTests += raw.numPassedTests ?? 0;
    aggregate.numFailedTests += raw.numFailedTests ?? 0;
    aggregate.numPendingTests += raw.numPendingTests ?? 0;

    function collectFailures(suite, prefix = "") {
      const name = prefix + (suite.name || "");
      if (suite.assertionResults) {
        for (const t of suite.assertionResults) {
          if (t.status === "failed") {
            aggregate.failures.push({
              file: suite.name || prefix,
              test: t.fullName || t.title,
              message: (t.failureMessages || [])[0]?.slice(0, 300),
            });
          }
        }
      }
      if (suite.testResults) {
        for (const child of suite.testResults) collectFailures(child, name + " > ");
      }
    }
    collectFailures(raw);

    if (raw.testResults) {
      for (const suite of raw.testResults) {
        aggregate.slowSuites.push({
          file: suite.name,
          durationMs: Math.round((suite.endTime ?? 0) - (suite.startTime ?? 0)),
        });
      }
    }
  } catch (err) {
    console.error(`[waka-test-batches] failed to parse batch ${i}:`, err.message);
    aggregate.failures.push({ file: `batch-${i}`, test: "batch-run", message: `exit ${result.status}` });
  }
}

aggregate.slowSuites.sort((a, b) => b.durationMs - a.durationMs);
const reportPath = path.join(root, "test-certification-aggregate.json");
writeFileSync(reportPath, JSON.stringify(aggregate, null, 2));
console.log("\n[waka-test-batches] SUMMARY");
console.log(`  suites: ${aggregate.numPassedTestSuites}/${aggregate.numTotalTestSuites} passed`);
console.log(`  tests:  ${aggregate.numPassedTests}/${aggregate.numTotalTests} passed (${aggregate.numFailedTests} failed)`);
console.log(`  failures: ${aggregate.failures.length}`);
console.log(`  report: ${reportPath}`);
process.exit(aggregate.numFailedTests > 0 || aggregate.failures.some((f) => f.test === "batch-run") ? 1 : 0);
