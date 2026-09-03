#!/usr/bin/env node
/**
 * ASK-INTEL-1/2: generate a bounded, read-only WAKA knowledge artifact for Edge retrieval.
 * Does not index secrets, dumps, build outputs, or transcripts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "supabase/functions/_shared");
const OUT_JSON = join(OUT_DIR, "wakaKnowledgeArtifact.json");

const MAX_DOC_EXCERPT = 1200;
const MAX_CODE_EXCERPT = 280;
const MAX_FILES_PER_COMMIT = 24;
const MAX_SYMBOLS = 96;
const MAX_FILE_SYMBOL_SCAN = 400;
const MAX_CODE_FILES = 2400;
const MAX_TEST_FILES = 250;
const MAX_SYMBOL_INDEX = 8000;
const MAX_RELATIONSHIPS = 6000;

const EXCLUDE_DIR = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  ".tmp-home-inspect",
  "lovable-import",
  ".cursor",
  "agent-transcripts",
  "playwright-report",
  "test-results",
]);

const EXCLUDE_PATH_RE = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)\.env\./i,
  /credential/i,
  /service.?role/i,
  /\.pem$/i,
  /\.key$/i,
  /private.?key/i,
  /supabase\/\.temp\//,
  /android\/app\/build\//,
  /android\/build\//,
  /ios\/App\/build\//,
  /src\/lib\/i18n\.ts$/,
  /\.map$/,
  /\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|mp4|zip|apk|aab)$/i,
];

const SECRET_CONTENT_RE = [
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /SUPABASE_SERVICE_ROLE_KEY\s*=/,
  /DEEPSEEK_API_KEY\s*=\s*['\"]?sk-/,
];

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".java", ".kt"]);
const DOC_EXT = new Set([".md"]);

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function shouldExcludePath(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => EXCLUDE_DIR.has(p))) return true;
  return EXCLUDE_PATH_RE.some((re) => re.test(rel));
}

function looksSecret(content) {
  return SECRET_CONTENT_RE.some((re) => re.test(content));
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    const rel = relative(ROOT, abs).replaceAll("\\", "/");
    if (shouldExcludePath(rel)) continue;
    if (ent.isDirectory()) {
      walk(abs, acc);
      continue;
    }
    if (!ent.isFile()) continue;
    acc.push(rel);
  }
  return acc;
}

function inferDocStatus(path, content) {
  const n = path.toLowerCase();
  const head = content.slice(0, 2500).toLowerCase();
  if (/\bdeprecated\b/.test(n) || /^\s*#.*deprecated/m.test(head)) return "DEPRECATED";
  if (/\bpaused\b/.test(n) || /\bstatus:\s*paused\b/.test(head)) return "PAUSED";
  if (/\bfrozen\b/.test(n) || /\bfrozen domain/.test(head)) return "FROZEN";
  if (/certification/.test(n) || /\baccepted\b/.test(n)) return "ACCEPTED";
  if (/forensic/.test(n) || /_audit/.test(n) || /audit\.md$/.test(n) || /investigation/.test(n)) return "AUDITED";
  if (/implementation/.test(n)) return "IMPLEMENTED";
  if (/phase_ask_waka_0/.test(n)) return "AUDITED";
  if ((/spec\.md$/.test(n) || /_0_/.test(n) || /plan/.test(n)) && !/certification|implementation/.test(n)) {
    return "PLANNED";
  }
  if (path === "README.md" || n.endsWith("docs/deployment.md") || n.endsWith("docs/android.md")) return "CURRENT";
  return "UNDECLARED";
}

function titleFromMarkdown(path, content) {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].replace(/[*_`]/g, "").trim().slice(0, 160);
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "").replaceAll("_", " ");
}

function headingsFromMarkdown(content) {
  const out = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^#{2,3}\s+(.+)$/);
    if (m) out.push(m[1].replace(/[*_`]/g, "").trim().slice(0, 120));
    if (out.length >= 12) break;
  }
  return out;
}

function excerptOf(content, max) {
  const t = content.replace(/\r\n/g, "\n").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

const TS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "typeof", "await",
  "new", "void", "super", "this", "import", "export", "class", "extends", "from",
]);

function fileLanguage(path) {
  const i = path.lastIndexOf(".");
  const ext = i >= 0 ? path.slice(i).toLowerCase() : "";
  if (ext === ".tsx" || ext === ".jsx") return "tsx";
  if (ext === ".ts" || ext === ".mts") return "ts";
  if (ext === ".js" || ext === ".mjs") return "js";
  if (ext === ".java") return "java";
  if (ext === ".kt") return "kt";
  return "text";
}

function fileCategory(path) {
  if (path.includes(".test.")) return "test";
  if (path.startsWith("src/offline/")) return "offline";
  if (path.startsWith("src/store/")) return "store";
  if (path.startsWith("src/lib/ai/")) return "ai";
  if (path.startsWith("src/lib/")) return "lib";
  if (path.startsWith("src/features/")) return "features";
  if (path.startsWith("src/components/")) return "ui";
  if (path.startsWith("src/pages/")) return "pages";
  if (path.startsWith("supabase/functions/")) return "edge";
  if (path.startsWith("android/")) return "android";
  return "app";
}

function classifySymbol(name, kindHint, path) {
  if (kindHint === "class" || kindHint === "type" || kindHint === "interface" || kindHint === "rpc") return kindHint;
  if (name.startsWith("use") && name.length > 3 && /[A-Z]/.test(name[3] || "")) return "hook";
  if ((path.endsWith(".tsx") || path.endsWith(".jsx")) && /^[A-Z]/.test(name)) return "component";
  return kindHint;
}

function rankSymbolMeta(s) {
  let r = 0;
  if (s.exported) r += 40;
  if (s.kind === "hook" || s.kind === "component" || s.kind === "class") r += 16;
  if (s.kind === "rpc" || s.kind === "edge") r += 12;
  if (s.kind === "type" || s.kind === "interface") r += 8;
  const n = s.name;
  if (n.length >= 14) r += 14;
  else if (n.length >= 10) r += 10;
  else if (n.length >= 8) r += 5;
  if (/[A-Z]/.test(n.slice(1))) r += 10;
  return r;
}

function leadingPrefix(name) {
  const m = name.match(/^[a-z]+/);
  return m ? m[0] : name.slice(0, 4).toLowerCase();
}

function selectFileSymbols(symbols) {
  if (symbols.length <= MAX_SYMBOLS) return symbols;
  const MAX_PER_PREFIX = 4;
  const preferred = [];
  const rest = [];
  for (const s of symbols) {
    if (s.exported || s.kind === "hook" || s.kind === "component" || s.kind === "rpc" || s.kind === "edge") preferred.push(s);
    else rest.push(s);
  }
  const out = [];
  const seen = new Set();
  const take = (s) => {
    if (seen.has(s.name) || out.length >= MAX_SYMBOLS) return;
    seen.add(s.name);
    out.push(s);
  };
  for (const s of preferred) take(s);
  const buckets = new Map();
  for (const s of rest) {
    const p = leadingPrefix(s.name);
    const list = buckets.get(p) ?? [];
    list.push(s);
    buckets.set(p, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => rankSymbolMeta(b) - rankSymbolMeta(a) || b.name.length - a.name.length);
  }
  const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
  for (let round = 0; round < MAX_PER_PREFIX && out.length < MAX_SYMBOLS; round++) {
    for (const k of keys) {
      const s = buckets.get(k)?.[round];
      if (s) take(s);
      if (out.length >= MAX_SYMBOLS) break;
    }
  }
  for (const s of rest) take(s);
  return appendLeftoverDistinctive(out, symbols);
}

function appendLeftoverDistinctive(kept, all) {
  const extraCap = 80;
  if (all.length <= kept.length) return kept;
  const keptSet = new Set(kept.map((s) => s.name));
  const keptPrefixes = new Set(kept.map((s) => leadingPrefix(s.name)));
  const buckets = new Map();
  for (const s of all) {
    if (keptSet.has(s.name) || s.name.length < 10 || !/[A-Z]/.test(s.name.slice(1))) continue;
    const p = leadingPrefix(s.name);
    const list = buckets.get(p) ?? [];
    list.push(s);
    buckets.set(p, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  }
  const siblingKeys = [...buckets.keys()].filter((k) => keptPrefixes.has(k)).sort((a, b) => a.localeCompare(b));
  const otherKeys = [...buckets.keys()].filter((k) => !keptPrefixes.has(k)).sort((a, b) => a.localeCompare(b));
  const extra = [];
  const takeRound = (keys, round) => {
    for (const k of keys) {
      const s = buckets.get(k)?.[round];
      if (!s || extra.length >= extraCap) continue;
      extra.push(s);
    }
  };
  for (let round = 0; round < 3 && extra.length < extraCap; round++) {
    takeRound(siblingKeys, round);
    takeRound(otherKeys, round);
  }
  return extra.length ? [...kept, ...extra] : kept;
}

function extractFileIntel(path, content) {
  const symbols = [];
  const imports = [];
  const callees = [];
  const seen = new Set();
  const push = (name, kind, exported) => {
    if (!name || name.length < 2 || seen.has(name) || symbols.length >= MAX_FILE_SYMBOL_SCAN) return;
    seen.add(name);
    symbols.push({ name, kind: classifySymbol(name, kind, path), exported });
  };
  try {
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const base = (path.split("/").pop() ?? "").replace(/\.(ts|tsx|js|mjs)$/i, "");
    if (base && base !== "index" && base.length >= 6 && /[A-Z]/.test(base)) {
      const kind = path.endsWith(".tsx") || path.endsWith(".jsx") ? "component" : /^use[A-Z]/.test(base) ? "hook" : "constant";
      push(base, kind, true);
    }
    const specs = [
      [/\bexport\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g, "function", true],
      [/\bexport\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/g, "class", true],
      [/\bexport\s+type\s+([A-Za-z_][A-Za-z0-9_]*)/g, "type", true],
      [/\bexport\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)/g, "interface", true],
      [/\bexport\s+(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)/g, "constant", true],
      [/\b(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g, "function", false],
    ];
    for (const [re, kind, exported] of specs) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(stripped))) push(m[1], kind, exported);
    }
    const methodRe = /\b([A-Za-z_][A-Za-z0-9_]{3,})\s*[:=]\s*(?:async\s*)?(?:\(|function\b)/g;
    let method;
    while ((method = methodRe.exec(stripped))) push(method[1], "function", false);
    const rpcRe = /\b(?:rpc|invoke)\(\s*['"]([a-z][a-z0-9_]+)['"]/g;
    let rpc;
    while ((rpc = rpcRe.exec(content))) push(rpc[1], "rpc", false);
    const impRe = /from\s+['"](\.[^'"]+)['"]/g;
    let imp;
    while ((imp = impRe.exec(content))) {
      if (imports.length < 12) imports.push(imp[1].replaceAll("\\", "/").slice(0, 160));
    }
    const local = new Set(symbols.map((s) => s.name));
    const callRe = /\b([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g;
    let c;
    while ((c = callRe.exec(stripped))) {
      const name = c[1];
      if (TS_KEYWORDS.has(name) || local.has(name)) continue;
      if (!callees.includes(name) && callees.length < 16) callees.push(name);
    }
    const header = content.match(/^\s*\/\*\*([\s\S]*?)\*\//) ?? content.match(/^\s*\/\/\s*(.+)$/m);
    let description = "";
    if (header) {
      description = String(header[1] ?? header[0]).replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CODE_EXCERPT);
    }
    const kept = selectFileSymbols(symbols);
    if (!description) {
      const names = kept.slice(0, 6).map((s) => s.name).join(", ");
      description = names ? `Defines ${names}.` : `${fileCategory(path)} module.`;
    }
    return { symbols: kept, imports, callees, description, language: fileLanguage(path), category: fileCategory(path) };
  } catch {
    return {
      symbols: [],
      imports: [],
      callees: [],
      description: `${fileCategory(path)} module.`,
      language: fileLanguage(path),
      category: fileCategory(path),
    };
  }
}

function indexDocs() {
  const docs = [];
  const roots = ["docs", "README.md", "AUDIT.md", "IOS_SETUP.md"];
  const files = [];
  for (const r of roots) {
    const abs = join(ROOT, r);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) files.push(r);
    else files.push(...walk(abs).filter((p) => DOC_EXT.has(extname(p))));
  }
  for (const rel of files) {
    if (shouldExcludePath(rel)) continue;
    let content;
    try {
      content = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    if (looksSecret(content)) continue;
    docs.push({
      path: rel,
      title: titleFromMarkdown(rel, content),
      status: inferDocStatus(rel, content),
      headings: headingsFromMarkdown(content),
      excerpt: excerptOf(content, MAX_DOC_EXCERPT),
    });
  }
  return docs;
}

function extname(p) {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

function indexCode() {
  const allowRoots = ["src", "supabase/functions", "android/app/src/main/java"];
  const files = [];
  for (const r of allowRoots) {
    const abs = join(ROOT, r);
    if (!existsSync(abs)) continue;
    files.push(...walk(abs).filter((p) => CODE_EXT.has(extname(p))));
  }
  const filtered = files.filter((p) => {
    if (p.endsWith(".d.ts")) return false;
    return true;
  });
  const rankPath = (p) => {
    if (p.includes(".test.")) return 9;
    if (p.startsWith("src/offline/")) return 0;
    if (p.startsWith("src/store/")) return 1;
    if (p.startsWith("src/lib/")) return 2;
    if (p.startsWith("src/features/")) return 3;
    if (p.startsWith("supabase/functions/")) return 4;
    if (p.startsWith("android/")) return 5;
    return 6;
  };
  filtered.sort((a, b) => rankPath(a) - rankPath(b) || a.localeCompare(b));

  const byDirTests = new Map();
  for (const p of filtered) {
    if (!p.includes(".test.")) continue;
    const dir = dirname(p);
    const stem = (p.split("/").pop() ?? "").replace(/\.test\.(ts|tsx|js)$/i, "");
    const list = byDirTests.get(dir) ?? [];
    list.push(p);
    byDirTests.set(dir, list);
    byDirTests.set(`${dir}::${stem}`, list);
  }

  const code = [];
  let n = 0;
  let testCount = 0;
  for (const rel of filtered) {
    const isTest = rel.includes(".test.");
    if (isTest && testCount >= MAX_TEST_FILES) continue;
    if (n >= MAX_CODE_FILES) break;
    let content;
    try {
      content = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    if (looksSecret(content)) continue;
    const intel = extractFileIntel(rel, content);
    const relatedTests = [];
    if (!isTest) {
      const base = (rel.split("/").pop() ?? "").replace(/\.(ts|tsx|js|mjs)$/i, "");
      const dir = dirname(rel);
      for (const t of byDirTests.get(dir) ?? []) {
        if (t.includes(base)) relatedTests.push(t);
      }
    }
    code.push({
      path: rel,
      kind: isTest ? "test" : "code",
      language: intel.language,
      category: intel.category,
      symbols: intel.symbols.map((s) => s.name),
      symbolMeta: intel.symbols,
      imports: intel.imports,
      callees: intel.callees,
      excerpt: intel.description,
      tests: relatedTests.slice(0, 4),
    });
    n += 1;
    if (isTest) testCount += 1;
  }
  attachCrossFileTests(code);
  return code;
}

function attachCrossFileTests(code) {
  const pathSet = new Set(code.map((c) => c.path));
  const tests = code.filter((c) => c.kind === "test");
  const prod = code.filter((c) => c.kind === "code");
  const owners = new Map();
  for (const row of prod) {
    for (const s of row.symbols ?? []) {
      if (s.length < 12) continue;
      const set = owners.get(s) ?? new Set();
      set.add(row.path);
      owners.set(s, set);
    }
  }
  const uniqueFor = (path) =>
    new Set(
      [...owners.entries()]
        .filter(([, files]) => files.size === 1 && files.has(path))
        .map(([n]) => n),
    );

  for (const row of prod) {
    const found = new Map();
    const bump = (p, s) => found.set(p, (found.get(p) ?? 0) + s);
    for (const t of row.tests ?? []) bump(t, 20);
    const uniq = uniqueFor(row.path);
    for (const t of tests) {
      let imported = false;
      for (const spec of t.imports ?? []) {
        if (resolveRelativeImport(t.path, spec, pathSet) === row.path) imported = true;
      }
      if (!imported) continue;
      let extra = 4;
      const names = new Set([...(t.symbols ?? []), ...(t.callees ?? [])]);
      for (const n of uniq) if (names.has(n)) extra += 8;
      bump(t.path, extra);
    }
    row.tests = [...found.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([p]) => p);
  }
}

function resolveRelativeImport(fromPath, spec, pathSet) {
  if (!spec.startsWith(".")) return null;
  const normalized = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.mjs`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
  ];
  for (const c of candidates) {
    if (pathSet.has(c)) return c;
  }
  return null;
}

function buildSymbolIndex(code) {
  const symbols = [];
  for (const row of code) {
    if (row.kind === "test") continue;
    for (const meta of row.symbolMeta ?? []) {
      symbols.push({ name: meta.name, kind: meta.kind, file: row.path, exported: meta.exported === true });
      if (symbols.length >= MAX_SYMBOL_INDEX) return symbols;
    }
  }
  return symbols;
}

function buildRelationships(code, docs) {
  const pathSet = new Set(code.map((r) => r.path));
  const uniqueProd = new Map();
  for (const row of code) {
    if (row.kind === "test") continue;
    for (const meta of row.symbolMeta ?? []) {
      const list = uniqueProd.get(meta.name) ?? [];
      list.push(row.path);
      uniqueProd.set(meta.name, list);
    }
  }
  const rel = [];
  const push = (from, to, kind, confidence) => {
    if (!from || !to || from === to) return;
    rel.push({ from, to, kind, confidence });
  };

  for (const row of code) {
    for (const t of row.tests ?? []) push(row.path, t, "test", "high");
    for (const spec of row.imports ?? []) {
      const resolved = resolveRelativeImport(row.path, spec, pathSet);
      if (resolved) push(row.path, resolved, "import", "high");
    }
    for (const callee of row.callees ?? []) {
      const files = uniqueProd.get(callee);
      if (!files || files.length !== 1) continue;
      if (files[0] === row.path) continue;
      push(row.path, callee, "call", "medium");
      if (rel.length >= MAX_RELATIONSHIPS) return rel.slice(0, MAX_RELATIONSHIPS);
    }
  }

  const stem = (p) => (p.split("/").pop() ?? "").replace(/\.(ts|tsx|js|mjs|md)$/i, "").toLowerCase();
  for (const row of code) {
    if (row.kind === "test") continue;
    const fileStem = stem(row.path);
    const names = new Set((row.symbols ?? []).filter((n) => n.length >= 6).map((n) => n.toLowerCase()));
    let linked = 0;
    for (const doc of docs) {
      const hay = `${doc.path} ${doc.title} ${doc.excerpt}`.toLowerCase();
      if (fileStem.length >= 6 && hay.includes(fileStem)) {
        push(row.path, doc.path, "doc", "medium");
        linked += 1;
      } else if ([...names].some((n) => hay.includes(n))) {
        push(row.path, doc.path, "doc", "low");
        linked += 1;
      }
      if (linked >= 2) break;
    }
    if (rel.length >= MAX_RELATIONSHIPS) break;
  }
  return rel.slice(0, MAX_RELATIONSHIPS);
}

function indexGit() {
  let raw = "";
  try {
    raw = git(["log", "--date=iso-strict", "--pretty=format:%H%x09%cI%x09%s", "--name-only"]);
  } catch (e) {
    console.error("git log failed", e);
    return [];
  }
  const commits = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      if (cur) {
        commits.push(cur);
        cur = null;
      }
      continue;
    }
    if (line.includes("\t") && /^[0-9a-f]{40}\t/.test(line)) {
      if (cur) commits.push(cur);
      const [hash, date, ...subjectParts] = line.split("\t");
      cur = { hash, date, subject: subjectParts.join("\t").slice(0, 200), files: [] };
      continue;
    }
    if (cur && !line.startsWith(" ")) {
      if (cur.files.length < MAX_FILES_PER_COMMIT && !shouldExcludePath(line.trim())) {
        cur.files.push(line.trim());
      }
    }
  }
  if (cur) commits.push(cur);

  for (const c of commits) {
    const blob = `${c.subject} ${c.files.join(" ")}`.toLowerCase();
    if (/\bmb-?1\b|shopscope|persistence namespace/.test(blob)) c.milestone = "MB-1";
    else if (/android startup|wakaappupdate|mainactivity/.test(blob)) c.milestone = "Android startup";
    else if (/ask.?waka|ai-ask-waka/.test(blob)) c.milestone = "Ask WAKA";
  }
  return commits;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const head = git(["rev-parse", "HEAD"]).trim();
  const branch = git(["branch", "--show-current"]).trim() || "HEAD";
  const docs = indexDocs();
  const commits = indexGit();
  const code = indexCode();
  const symbols = buildSymbolIndex(code);
  const relationships = buildRelationships(code, docs);
  const artifact = {
    version: 2,
    generated_at: new Date().toISOString(),
    head,
    branch,
    docs,
    commits,
    code,
    symbols,
    relationships,
  };

  const json = `${JSON.stringify(artifact)}\n`;
  writeFileSync(OUT_JSON, json);
  const bytes = Buffer.byteLength(json);
  console.log(
    JSON.stringify(
      {
        out: relative(ROOT, OUT_JSON),
        bytes,
        docs: docs.length,
        commits: commits.length,
        code: code.length,
        symbols: symbols.length,
        relationships: relationships.length,
        head: artifact.head,
      },
      null,
      2,
    ),
  );
  if (bytes > 4_500_000) {
    console.warn("WARNING: artifact exceeds 4.5MB; consider tightening excerpts.");
  }
}

main();
