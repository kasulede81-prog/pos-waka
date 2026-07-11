/**
 * Phase 17.9 bulk migration: stone/white utilities → semantic theme tokens.
 * Excludes marketing, print HTML, and brand hex constants.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");

const SKIP_DIRS = new Set([
  "marketing",
  "node_modules",
]);

const SKIP_FILES = new Set([
  "receiptPrint.ts",
  "launcherTiles.ts",
  "launcherTiles.test.ts",
]);

/** Longest-first replacements for Tailwind stone/white → semantic tokens */
const REPLACEMENTS = [
  ["border-stone-300/80", "border-border/80"],
  ["border-stone-300", "border-border"],
  ["border-stone-200/80", "border-border/80"],
  ["border-stone-200", "border-border"],
  ["border-stone-100", "border-border"],
  ["border-stone-50", "border-border"],
  ["ring-stone-300", "ring-border"],
  ["ring-stone-200", "ring-border"],
  ["ring-stone-100", "ring-border"],
  ["divide-stone-200", "divide-border"],
  ["shadow-\\[inset_0_-1px_0_theme\\(colors\\.stone\\.200\\)\\]", "shadow-[inset_0_-1px_0_hsl(var(--border))]"],
  ["shadow-\\[inset_0_-1px_0_theme\\(colors\\.stone\\.700\\)\\]", "shadow-[inset_0_-1px_0_hsl(var(--border))]"],
  ["bg-stone-950/85", "bg-overlay/85"],
  ["bg-stone-950/70", "bg-overlay/70"],
  ["bg-stone-900/50", "bg-overlay/50"],
  ["bg-stone-900/90", "bg-foreground/90"],
  ["bg-stone-800/90", "bg-foreground/90"],
  ["bg-stone-950", "bg-foreground"],
  ["bg-stone-900", "bg-foreground"],
  ["bg-stone-800", "bg-foreground"],
  ["via-stone-800", "via-foreground/80"],
  ["via-stone-950", "via-foreground"],
  ["ring-stone-900/5", "ring-foreground/5"],
  ["supports-\\[backdrop-filter\\]:bg-white/90", "supports-[backdrop-filter]:bg-card/90"],
  ["bg-white/95", "bg-card/95"],
  ["dark:from-stone-950", "dark:from-foreground"],
  ["dark:bg-stone-950", "dark:bg-foreground"],
  ["dark:border-stone-600", "dark:border-border"],
  ["active:bg-stone-800", "active:bg-foreground/90"],
  ["hover:bg-stone-800", "hover:bg-foreground/90"],
  ["from-stone-900", "from-foreground"],
  ["to-stone-700", "to-foreground/80"],
  ["to-stone-900", "to-foreground"],
  ["bg-stone-200/80", "bg-muted/80"],
  ["bg-stone-50/50", "bg-muted/50"],
  ["bg-stone-50/30", "bg-muted/30"],
  ["bg-stone-50", "bg-muted"],
  ["bg-stone-100", "bg-muted"],
  ["bg-stone-200", "bg-muted"],
  ["bg-stone-300", "bg-border"],
  ["bg-\\[#f8fafc\\]", "bg-background"],
  ["text-stone-950", "text-foreground"],
  ["text-stone-900", "text-foreground"],
  ["text-stone-800", "text-foreground"],
  ["text-stone-700", "text-muted-foreground"],
  ["text-stone-600", "text-muted-foreground"],
  ["text-stone-500", "text-muted-foreground"],
  ["text-stone-400", "text-muted-foreground"],
  ["text-stone-300", "text-muted-foreground"],
  ["text-stone-200", "text-muted-foreground"],
  ["text-stone-100", "text-background"],
  ["text-stone-50", "text-background"],
  ["hover:bg-stone-100", "hover:bg-muted"],
  ["hover:bg-stone-50", "hover:bg-muted"],
  ["hover:text-stone-900", "hover:text-foreground"],
  ["hover:text-stone-800", "hover:text-foreground"],
  ["hover:border-stone-300", "hover:border-border"],
  ["active:bg-stone-100", "active:bg-muted"],
  ["active:bg-stone-50", "active:bg-muted"],
  ["from-stone-50", "from-muted"],
  ["to-stone-50", "to-muted"],
  ["via-white", "via-card"],
  ["to-white", "to-card"],
  // Remove redundant dark:stone overrides — semantic tokens handle both themes
  [" dark:border-stone-800", ""],
  [" dark:border-stone-700", ""],
  [" dark:bg-stone-900", ""],
  [" dark:bg-stone-800", ""],
  [" dark:text-stone-100", ""],
  [" dark:text-stone-50", ""],
  [" dark:text-stone-200", ""],
  [" dark:active:bg-stone-800", ""],
  [" dark:shadow-none", ""],
];

/** bg-white → bg-card (skip opacity overlays like bg-white/10) */
const BG_WHITE_RE = /\bbg-white\b(?!\/)/g;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(tsx?|css)$/.test(name) && !SKIP_FILES.has(name)) files.push(full);
  }
  return files;
}

function migrate(content) {
  let out = content;
  for (const [from, to] of REPLACEMENTS) {
    if (!from) continue;
    out = out.replace(new RegExp(from, "g"), to);
  }
  out = out.replace(BG_WHITE_RE, "bg-card");
  // Inverse buttons: foreground surface needs background-colored text
  out = out.replace(/bg-foreground([^"'`]*?)text-white/g, "bg-foreground$1text-background");
  out = out.replace(/bg-foreground\/90([^"'`]*?)text-white/g, "bg-foreground/90$1text-background");
  return out;
}

const files = walk(ROOT);
let changed = 0;
let totalReplacements = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = migrate(before);
  if (after !== before) {
    const count = before.length - after.length !== 0 ? 1 : 0;
    writeFileSync(file, after, "utf8");
    changed++;
    totalReplacements += count;
  }
}

console.log(`Migrated ${changed} files under src/ (excluding marketing)`);
