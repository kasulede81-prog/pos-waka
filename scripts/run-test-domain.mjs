#!/usr/bin/env node
/**
 * Run Vitest for a named enterprise test domain (see scripts/test-domains.json).
 * Usage: node scripts/run-test-domain.mjs retail
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const domain = process.argv[2]?.trim();
if (!domain) {
  console.error("Usage: node scripts/run-test-domain.mjs <domain>");
  console.error("Domains: retail, hospitality, pharmacy, platform, sync, printing, inventory, staff, reports, compliance, kitchen, payments, cloud, device");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(path.join(root, "scripts/test-domains.json"), "utf8"));
const patterns = map[domain];
if (!patterns?.length) {
  console.error(`Unknown domain: ${domain}`);
  process.exit(1);
}

const args = ["vitest", "run", ...patterns, "--testTimeout=15000", "--hookTimeout=15000", "--pool=threads"];
console.log(`[waka-test] domain=${domain} patterns=${patterns.length}`);
const result = spawnSync("npx", args, { cwd: root, stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
