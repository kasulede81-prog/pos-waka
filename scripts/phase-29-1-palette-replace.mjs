#!/usr/bin/env node
/**
 * Phase 29.1 — one-shot high-traffic hard-coded palette → semantic tokens.
 * Idempotent-ish; run once from repo root.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TARGETS = [
  "src/components/pos",
  "src/components/inventory",
  "src/features/inventory",
  "src/components/stock",
  "src/components/command-center",
  "src/components/home",
  "src/pages/PosPage.tsx",
  "src/pages/StockPage.tsx",
  "src/pages/CustomersPage.tsx",
  "src/pages/ReportsPage.tsx",
  "src/pages/OwnerDashboardPage.tsx",
  "src/pages/InventoryPurchasingPage.tsx",
];

/** Ordered replacements — longer/more specific first */
const REPLACEMENTS = [
  // Overlays
  [/bg-black\/55/g, "bg-overlay/55"],
  [/bg-black\/50/g, "bg-overlay/50"],
  [/bg-black\/40/g, "bg-overlay/40"],

  // Surfaces
  [/bg-white\/98/g, "bg-card/95"],
  [/bg-white\/90/g, "bg-card/90"],
  [/bg-white\/80/g, "bg-card/80"],
  [/(?<![/\w-])bg-white(?![/\w-])/g, "bg-card"],

  // Success / emerald
  [/border-emerald-200/g, "border-success/30"],
  [/border-emerald-100/g, "border-success/20"],
  [/border-emerald-500\/40/g, "border-success/40"],
  [/border-emerald-500\/25/g, "border-success/25"],
  [/bg-emerald-950\/70/g, "bg-success-muted"],
  [/bg-emerald-50\/80/g, "bg-success-muted/80"],
  [/bg-emerald-50\/40/g, "bg-success-muted/40"],
  [/bg-emerald-50/g, "bg-success-muted"],
  [/bg-emerald-500\/15/g, "bg-success-muted"],
  [/bg-emerald-500\/10/g, "bg-success-muted/80"],
  [/bg-emerald-500\/5/g, "bg-success-muted/50"],
  [/bg-emerald-500/g, "bg-success"],
  [/bg-emerald-100/g, "bg-success-muted"],
  [/text-emerald-950/g, "text-success"],
  [/text-emerald-900\/90/g, "text-success"],
  [/text-emerald-900/g, "text-success"],
  [/text-emerald-800/g, "text-success"],
  [/text-emerald-700 dark:text-emerald-400/g, "text-success"],
  [/text-emerald-700/g, "text-success"],
  [/text-emerald-600 dark:text-emerald-400/g, "text-success"],
  [/text-emerald-600/g, "text-success"],
  [/text-emerald-200/g, "text-success"],
  [/text-emerald-100/g, "text-success"],
  [/text-emerald-400/g, "text-success"],

  // Danger / rose
  [/border-rose-200\/90/g, "border-danger/30"],
  [/border-rose-200/g, "border-danger/30"],
  [/border-rose-300/g, "border-danger/40"],
  [/border-rose-100/g, "border-danger/20"],
  [/border-rose-500/g, "border-danger"],
  [/border-rose-400/g, "border-danger"],
  [/bg-rose-50\/40/g, "bg-danger-muted/40"],
  [/bg-rose-50\/30/g, "bg-danger-muted/30"],
  [/bg-rose-50/g, "bg-danger-muted"],
  [/bg-rose-100/g, "bg-danger-muted"],
  [/bg-rose-200/g, "bg-danger-muted"],
  [/bg-rose-600/g, "bg-danger"],
  [/text-rose-950/g, "text-danger"],
  [/text-rose-900/g, "text-danger"],
  [/text-rose-800\/90/g, "text-danger"],
  [/text-rose-800/g, "text-danger"],
  [/text-rose-700 dark:text-rose-400/g, "text-danger"],
  [/text-rose-700/g, "text-danger"],
  [/text-rose-400/g, "text-danger"],
  [/text-danger-foreground/g, "text-danger"],

  // Warning / amber
  [/border-amber-400\/40/g, "border-warning/40"],
  [/border-amber-500\/30/g, "border-warning/30"],
  [/border-amber-500\/40/g, "border-warning/40"],
  [/border-amber-200/g, "border-warning/30"],
  [/border-amber-500/g, "border-warning"],
  [/bg-amber-950\/70/g, "bg-warning-muted"],
  [/bg-amber-950/g, "bg-warning-muted"],
  [/bg-amber-500\/15/g, "bg-warning-muted"],
  [/bg-amber-500\/10/g, "bg-warning-muted/80"],
  [/bg-amber-50/g, "bg-warning-muted"],
  [/bg-amber-100/g, "bg-warning-muted"],
  [/bg-amber-200/g, "bg-warning-muted"],
  [/bg-amber-400/g, "bg-warning"],
  [/bg-amber-600/g, "bg-warning"],
  [/text-amber-950/g, "text-warning-foreground"],
  [/text-amber-900/g, "text-warning-foreground"],
  [/text-amber-800/g, "text-warning-foreground"],
  [/text-amber-100/g, "text-warning-foreground"],
  [/dark:text-amber-100/g, "dark:text-warning-foreground"],
  [/dark:bg-amber-500\/15/g, "dark:bg-warning-muted"],
  [/dark:border-amber-500\/30/g, "dark:border-warning/30"],

  // Trial / violet / purple security
  [/border-violet-200/g, "border-trial/30"],
  [/border-violet-100/g, "border-trial/20"],
  [/border-violet-800\/60/g, "border-trial/40"],
  [/bg-violet-950/g, "bg-trial-muted"],
  [/bg-violet-50\/60/g, "bg-trial-muted/60"],
  [/bg-violet-50/g, "bg-trial-muted"],
  [/bg-violet-100/g, "bg-trial-muted"],
  [/bg-violet-600/g, "bg-trial"],
  [/text-violet-900/g, "text-trial"],
  [/text-violet-800/g, "text-trial"],
  [/text-violet-700/g, "text-trial"],
  [/text-violet-300/g, "text-trial"],
  [/text-violet-200/g, "text-trial"],
  [/dark:bg-violet-950/g, "dark:bg-trial-muted"],
  [/dark:text-violet-200/g, "dark:text-trial"],
  [/dark:text-violet-300/g, "dark:text-trial"],
  [/dark:border-violet-800\/60/g, "dark:border-trial/40"],
  [/dark:ring-violet-800\/60/g, "dark:ring-trial/40"],
  [/ring-violet-200\/80/g, "ring-trial/30"],

  // Success foreground misuse on muted contexts in high-traffic
  [/text-success-foreground/g, "text-success"],
];

function walk(path, out = []) {
  const st = statSync(path);
  if (st.isFile()) {
    if (/\.(tsx?|jsx?)$/.test(path)) out.push(path);
    return out;
  }
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === "dist") continue;
    walk(join(path, name), out);
  }
  return out;
}

let filesChanged = 0;
let totalSubs = 0;

for (const target of TARGETS) {
  const abs = join(ROOT, target);
  let files = [];
  try {
    files = walk(abs);
  } catch {
    console.warn("skip missing", target);
    continue;
  }
  for (const file of files) {
    let src = readFileSync(file, "utf8");
    const before = src;
    let subs = 0;
    for (const [re, to] of REPLACEMENTS) {
      const next = src.replace(re, to);
      if (next !== src) {
        const matches = src.match(re);
        subs += matches ? matches.length : 1;
        src = next;
      }
    }
    if (src !== before) {
      writeFileSync(file, src);
      filesChanged += 1;
      totalSubs += subs;
      console.log(`updated ${relative(ROOT, file)} (~${subs} subs)`);
    }
  }
}

console.log(`\nDone: ${filesChanged} files, ~${totalSubs} substitutions`);
