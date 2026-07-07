#!/usr/bin/env node
/** Run every enterprise domain and write test-certification-aggregate.json */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const domains = JSON.parse(readFileSync(path.join(root, "scripts/test-domains.json"), "utf8"));

const aggregate = {
  domains: {},
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  failures: [],
  slowSuites: [],
};

for (const [domain, files] of Object.entries(domains)) {
  const outFile = path.join(root, `.test-domain-${domain}.json`);
  const started = Date.now();
  console.log(`[waka-domains] ${domain} (${files.length} files)`);
  const result = spawnSync(
    "npx",
    ["vitest", "run", ...files, "--reporter=json", `--outputFile=${outFile}`, "--maxWorkers=2"],
    { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, CI: "1" } },
  );
  const ms = Date.now() - started;
  let passed = 0;
  let failed = 0;
  let total = 0;
  try {
    const raw = JSON.parse(readFileSync(outFile, "utf8"));
    passed = raw.numPassedTests ?? 0;
    failed = raw.numFailedTests ?? 0;
    total = raw.numTotalTests ?? 0;
    function walk(suite, prefix = "") {
      const name = prefix + (suite.name || "");
      if (suite.assertionResults) {
        for (const t of suite.assertionResults) {
          if (t.status === "failed") {
            aggregate.failures.push({
              domain,
              file: suite.name || prefix,
              test: t.fullName || t.title,
              message: (t.failureMessages || [])[0]?.slice(0, 280),
            });
          }
        }
      }
      if (suite.testResults) for (const c of suite.testResults) walk(c, name + " > ");
    }
    walk(raw);
    if (raw.testResults) {
      for (const s of raw.testResults) {
        aggregate.slowSuites.push({
          domain,
          file: s.name,
          durationMs: Math.round((s.endTime ?? 0) - (s.startTime ?? 0)),
        });
      }
    }
  } catch {
    aggregate.failures.push({ domain, file: domain, test: "domain-run", message: `exit ${result.status}` });
  }
  aggregate.domains[domain] = { total, passed, failed, ms, exitCode: result.status ?? 1 };
  aggregate.numTotalTests += total;
  aggregate.numPassedTests += passed;
  aggregate.numFailedTests += failed;
}

aggregate.slowSuites.sort((a, b) => b.durationMs - a.durationMs);
const reportPath = path.join(root, "test-certification-aggregate.json");
writeFileSync(reportPath, JSON.stringify(aggregate, null, 2));
console.log(`\n[waka-domains] ${aggregate.numPassedTests}/${aggregate.numTotalTests} passed, ${aggregate.numFailedTests} failed`);
console.log(`[waka-domains] report: ${reportPath}`);
process.exit(aggregate.numFailedTests > 0 ? 1 : 0);
