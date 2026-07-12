#!/usr/bin/env node
/**
 * Phase 22.2 — Design system enforcement scanner.
 * Run: npm run design-system:check
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const POS_DENSITY_ALLOW = [
  "posShelfLayout.ts",
  "displayScale",
  "EnterprisePinPad.tsx",
  "PosShelfTile.tsx",
  "PosSellProductCard.tsx",
];

const RULES = [
  {
    id: "fractional-typography",
    pattern: /text-\[(8|9|10|11|13|15|17|18|22)px\]/g,
    message: "Use enterpriseType roles; fractional sizes only in POS density modules",
  },
  {
    id: "inline-waka-cta",
    pattern: /\bbg-waka-600\b.*\bmin-h-\[(36|40|48|52|56)px\]/g,
    message: "Use WakaButton variant primary instead of inline bg-waka-600 buttons",
  },
  {
    id: "custom-page-wrapper",
    pattern: /className="space-y-5 pb-8"/g,
    message: "Use EnterprisePageContainer instead of manual pb-8 wrappers",
  },
  {
    id: "raw-desktop-table",
    pattern: /<table className="min-w-full text-left text-sm"/g,
    message: "Use ResponsiveDataTable or EnterpriseResponsiveTable",
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function allowedForPosDensity(filePath) {
  const rel = relative(SRC, filePath).replace(/\\/g, "/");
  return POS_DENSITY_ALLOW.some((frag) => rel.includes(frag));
}

const files = walk(SRC);
const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      if (rule.id === "fractional-typography" && allowedForPosDensity(file)) continue;
      const line = content.slice(0, match.index).split("\n").length;
      violations.push({ file: rel, line, rule: rule.id, message: rule.message, sample: match[0] });
    }
  }
}

if (violations.length === 0) {
  console.log("design-system:check — no violations in scanned rules");
  process.exit(0);
}

console.log(`design-system:check — ${violations.length} violation(s):\n`);
for (const v of violations.slice(0, 50)) {
  console.log(`${v.file}:${v.line} [${v.rule}] ${v.message} — ${v.sample}`);
}
if (violations.length > 50) {
  console.log(`… and ${violations.length - 50} more`);
}
process.exit(0);
