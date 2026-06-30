/**
 * One-off codemod: align app UI with Waka brand tokens (orange → waka, slate → stone in app).
 * Run: node scripts/apply-brand-tokens.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const SKIP_DIRS = new Set(["components/marketing", "lovable-import"]);
const EXT = new Set([".ts", ".tsx", ".css"]);

const REPLACEMENTS = [
  [/bg-orange-(\d+)/g, "bg-waka-$1"],
  [/text-orange-(\d+)/g, "text-waka-$1"],
  [/border-orange-(\d+)/g, "border-waka-$1"],
  [/ring-orange-(\d+)/g, "ring-waka-$1"],
  [/from-orange-(\d+)/g, "from-waka-$1"],
  [/to-orange-(\d+)/g, "to-waka-$1"],
  [/via-orange-(\d+)/g, "via-waka-$1"],
  [/decoration-orange-(\d+)/g, "decoration-waka-$1"],
  [/hover:bg-orange-(\d+)/g, "hover:bg-waka-$1"],
  [/hover:text-orange-(\d+)/g, "hover:text-waka-$1"],
  [/hover:border-orange-(\d+)/g, "hover:border-waka-$1"],
  [/active:bg-orange-(\d+)/g, "active:bg-waka-$1"],
  [/focus:border-orange-(\d+)/g, "focus:border-waka-$1"],
  [/focus:ring-orange-(\d+)/g, "focus:ring-waka-$1"],
  [/shadow-orange-(\d+)/g, "shadow-waka-$1"],
  [/bg-\[#faf7f4\]/g, "bg-brand-cream-wash"],
  [/bg-\[#fffaf5\]/g, "bg-brand-cream"],
  [/text-slate-(\d+)/g, "text-stone-$1"],
  [/bg-slate-(\d+)/g, "bg-stone-$1"],
  [/border-slate-(\d+)/g, "border-stone-$1"],
  [/ring-slate-(\d+)/g, "ring-stone-$1"],
  [/from-slate-(\d+)/g, "from-stone-$1"],
  [/to-slate-(\d+)/g, "to-stone-$1"],
  [/hover:bg-slate-(\d+)/g, "hover:bg-stone-$1"],
  [/hover:text-slate-(\d+)/g, "hover:text-stone-$1"],
];

function shouldSkip(rel) {
  return [...SKIP_DIRS].some((d) => rel.includes(d.replace(/\//g, path.sep)));
}

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(ROOT, full);
    if (ent.isDirectory()) {
      if (!shouldSkip(rel)) walk(full, files);
    } else if (EXT.has(path.extname(ent.name)) && !shouldSkip(rel)) {
      files.push(full);
    }
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  for (const [re, rep] of REPLACEMENTS) {
    src = src.replace(re, rep);
  }
  if (src !== before) {
    fs.writeFileSync(file, src);
    changed += 1;
    console.log(path.relative(process.cwd(), file));
  }
}
console.log(`Updated ${changed} files.`);
