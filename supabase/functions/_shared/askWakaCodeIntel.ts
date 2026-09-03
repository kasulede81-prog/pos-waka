/**
 * ASK-INTEL-2 structured code intelligence + client-safe disclosure.
 * Parsing is deterministic regex; failures degrade to empty symbols, never throw.
 */

export type WakaSymbolKind =
  | "function"
  | "hook"
  | "component"
  | "class"
  | "type"
  | "interface"
  | "constant"
  | "rpc"
  | "edge"
  | "unknown";

export type WakaRelKind = "import" | "export" | "call" | "test" | "doc" | "git";
export type WakaRelConfidence = "high" | "medium" | "low";

export type WakaSymbolMeta = {
  name: string;
  kind: WakaSymbolKind;
  exported: boolean;
};

export type WakaSymbolRecord = {
  name: string;
  kind: WakaSymbolKind;
  file: string;
  exported: boolean;
};

export type WakaRelationship = {
  from: string;
  to: string;
  kind: WakaRelKind;
  confidence: WakaRelConfidence;
};

export type WakaFileIntel = {
  symbols: WakaSymbolMeta[];
  imports: string[];
  callees: string[];
  description: string;
  language: string;
  category: string;
};

const TS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "typeof", "await",
  "new", "void", "super", "this", "import", "export", "class", "extends", "from",
]);

export const ASK_WAKA_SOURCE_DUMP_REFUSAL =
  "I can explain how that part of WAKA works, but I can't provide internal source code through the client assistant.";

export const ASK_WAKA_SECRET_REFUSAL =
  "I can't share credentials, environment values, keys, or other secrets.";

export const ASK_WAKA_PATH_REFUSAL =
  "I can explain the feature, but I don't share internal file paths.";

export const ASK_WAKA_NO_TEST_EVIDENCE =
  "I couldn't find a relevant test in the indexed WAKA project knowledge.";

const JS_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".jsx"]);

export function fileLanguage(path: string): string {
  const i = path.lastIndexOf(".");
  const ext = i >= 0 ? path.slice(i).toLowerCase() : "";
  if (ext === ".tsx" || ext === ".jsx") return "tsx";
  if (ext === ".ts" || ext === ".mts") return "ts";
  if (ext === ".js" || ext === ".mjs") return "js";
  if (ext === ".java") return "java";
  if (ext === ".kt") return "kt";
  return "text";
}

export function fileCategory(path: string): string {
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

function classifySymbol(name: string, kindHint: WakaSymbolKind, path: string): WakaSymbolKind {
  if (kindHint === "class" || kindHint === "type" || kindHint === "interface" || kindHint === "rpc") {
    return kindHint;
  }
  if (name.startsWith("use") && name.length > 3 && name[3] === name[3]?.toUpperCase()) return "hook";
  if ((path.endsWith(".tsx") || path.endsWith(".jsx")) && /^[A-Z]/.test(name)) return "component";
  if (path.includes("supabase/functions/") && (name === "Deno" || path.endsWith("index.ts"))) {
    if (name === "serve" || path.endsWith("/index.ts")) return "edge";
  }
  return kindHint;
}

const MAX_FILE_SYMBOLS = 96;
const MAX_FILE_SYMBOL_SCAN = 400;

function rankSymbolMeta(s: WakaSymbolMeta): number {
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

function leadingPrefix(name: string): string {
  const m = name.match(/^[a-z]+/);
  return m ? m[0] : name.slice(0, 4).toLowerCase();
}

function selectFileSymbols(symbols: WakaSymbolMeta[]): WakaSymbolMeta[] {
  if (symbols.length <= MAX_FILE_SYMBOLS) return symbols;
  const MAX_PER_PREFIX = 4;
  const preferred: WakaSymbolMeta[] = [];
  const rest: WakaSymbolMeta[] = [];
  for (const s of symbols) {
    if (s.exported || s.kind === "hook" || s.kind === "component" || s.kind === "rpc" || s.kind === "edge") {
      preferred.push(s);
    } else rest.push(s);
  }
  const out: WakaSymbolMeta[] = [];
  const seen = new Set<string>();
  const take = (s: WakaSymbolMeta) => {
    if (seen.has(s.name) || out.length >= MAX_FILE_SYMBOLS) return false;
    seen.add(s.name);
    out.push(s);
    return true;
  };
  for (const s of preferred) take(s);
  const buckets = new Map<string, WakaSymbolMeta[]>();
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
  for (let round = 0; round < MAX_PER_PREFIX && out.length < MAX_FILE_SYMBOLS; round++) {
    for (const k of keys) {
      const s = buckets.get(k)?.[round];
      if (s) take(s);
      if (out.length >= MAX_FILE_SYMBOLS) break;
    }
  }
  for (const s of rest) take(s);
  return appendLeftoverDistinctive(out, symbols);
}

function appendLeftoverDistinctive(kept: WakaSymbolMeta[], all: WakaSymbolMeta[]): WakaSymbolMeta[] {
  const extraCap = 80;
  if (all.length <= kept.length) return kept;
  const keptSet = new Set(kept.map((s) => s.name));
  const keptPrefixes = new Set(kept.map((s) => leadingPrefix(s.name)));
  const buckets = new Map<string, WakaSymbolMeta[]>();
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
  const extra: WakaSymbolMeta[] = [];
  const takeRound = (keys: string[], round: number) => {
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

function pushSymbol(out: WakaSymbolMeta[], name: string, kind: WakaSymbolKind, exported: boolean, path: string) {
  if (!name || name.length < 2 || name.startsWith("_")) return;
  if (out.some((s) => s.name === name)) return;
  if (out.length >= MAX_FILE_SYMBOL_SCAN) return;
  out.push({ name, kind: classifySymbol(name, kind, path), exported });
}

/**
 * Deterministic file parse. Never throws.
 */
export function extractWakaFileIntel(path: string, content: string): WakaFileIntel {
  const symbols: WakaSymbolMeta[] = [];
  const imports: string[] = [];
  const callees: string[] = [];
  try {
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

    const base = path.split("/").pop()?.replace(/\.(ts|tsx|js|mjs)$/i, "") ?? "";
    if (base && base !== "index" && base.length >= 6 && /[A-Z]/.test(base)) {
      const kind: WakaSymbolKind =
        path.endsWith(".tsx") || path.endsWith(".jsx")
          ? "component"
          : /^use[A-Z]/.test(base)
            ? "hook"
            : "constant";
      pushSymbol(symbols, base, kind, true, path);
    }

    const patterns: Array<[RegExp, WakaSymbolKind, boolean]> = [
      [/\bexport\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g, "function", true],
      [/\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g, "function", true],
      [/\bexport\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/g, "class", true],
      [/\bexport\s+type\s+([A-Za-z_][A-Za-z0-9_]*)/g, "type", true],
      [/\bexport\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)/g, "interface", true],
      [/\bexport\s+(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)/g, "constant", true],
      [/\b(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g, "function", false],
      [/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g, "class", false],
    ];
    for (const [re, kind, exported] of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stripped))) {
        pushSymbol(symbols, m[1], kind, exported, path);
      }
    }

    const methodRe = /\b([A-Za-z_][A-Za-z0-9_]{3,})\s*[:=]\s*(?:async\s*)?(?:\(|function\b)/g;
    let method: RegExpExecArray | null;
    while ((method = methodRe.exec(stripped))) {
      pushSymbol(symbols, method[1], "function", false, path);
    }
    let rpc: RegExpExecArray | null;
    const rpcRe = /\b(?:rpc|invoke)\(\s*['"]([a-z][a-z0-9_]+)['"]/g;
    while ((rpc = rpcRe.exec(content))) {
      pushSymbol(symbols, rpc[1], "rpc", false, path);
    }

    const impRe = /from\s+['"](\.[^'"]+)['"]/g;
    let imp: RegExpExecArray | null;
    while ((imp = impRe.exec(content))) {
      const spec = imp[1].replace(/\\/g, "/");
      if (!imports.includes(spec) && imports.length < 12) imports.push(spec.slice(0, 160));
    }

    if (JS_EXT.has(extOf(path))) {
      const callRe = /\b([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g;
      let c: RegExpExecArray | null;
      const local = new Set(symbols.map((s) => s.name));
      while ((c = callRe.exec(stripped))) {
        const name = c[1];
        if (TS_KEYWORDS.has(name) || local.has(name)) continue;
        if (!callees.includes(name) && callees.length < 16) callees.push(name);
      }
    }

    const kept = selectFileSymbols(symbols);
    const header = content.match(/^\s*\/\*\*([\s\S]*?)\*\//) ?? content.match(/^\s*\/\/\s*(.+)$/m);
    let description = "";
    if (header) {
      description = String(header[1] ?? header[0])
        .replace(/^\s*\*\s?/gm, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
    }
    if (!description) {
      const names = kept.slice(0, 6).map((s) => s.name).join(", ");
      description = names ? `Defines ${names}.` : `${fileCategory(path)} module.`;
    }

    return {
      symbols: kept,
      imports,
      callees,
      description,
      language: fileLanguage(path),
      category: fileCategory(path),
    };
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

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

export function isAskWakaSourceDumpRequest(message: string): boolean {
  const t = message.toLowerCase();
  return (
    /\b(show|dump|paste|print|give)\b.{0,40}\b(source code|source file|the code|raw code|exact source|retrieved source)\b/.test(t) ||
    /\b(source code for|full source|verbatim code)\b/.test(t)
  );
}

export function isAskWakaSecretProbe(message: string): boolean {
  const t = message.toLowerCase();
  return (
    /\b(environment variables?|env vars?|\.env|api keys?|secret keys?|private keys?|service[- ]role|service_role|jwt secret|credentials?)\b/.test(t) &&
    /\b(show|give|tell|print|dump|what is|share|reveal)\b/.test(t)
  ) || /\b(service role key|supabase service|deepseek_api_key)\b/.test(t);
}

export function isAskWakaPathProbe(message: string): boolean {
  const t = message.toLowerCase();
  return (
    /\b(internal (file )?paths?|filesystem paths?|absolute paths?|repo paths?)\b/.test(t) &&
    /\b(show|give|list|tell|print)\b/.test(t)
  );
}

export function isAskWakaTestCoverageQuestion(message: string): boolean {
  const t = message.toLowerCase();
  return /\b(tested|test coverage|is this .{0,40}tested|are there tests)\b/.test(t);
}

const PATHISH = /(?:src|supabase|android|docs|scripts)\/[A-Za-z0-9_./+\-]+(?:\.(?:ts|tsx|js|mjs|md|sql|json))?/g;

export function scrubInternalPathsFromAnswer(answer: string): string {
  return answer.replace(PATHISH, "WAKA source");
}

export function looksLikeRawSourceDump(answer: string): boolean {
  const lines = answer.split("\n");
  const codeish = lines.filter((l) => /^(export |import |function |const |class |type |interface )/.test(l.trim())).length;
  return codeish >= 8 || (answer.includes("```") && answer.length > 1200);
}

export type ClientSafeSource = {
  type: "doc" | "code" | "git" | "test" | "milestone" | "pos_tool";
  title: string;
  label: string;
  date?: string;
  status?: string;
  chunk_id?: string;
};

export function toClientSafeSources(
  sources: ReadonlyArray<{
    type: string;
    title: string;
    path?: string;
    commit?: string;
    date?: string;
    status?: string;
    chunk_id?: string;
    tool?: string;
  }>,
): ClientSafeSource[] {
  const out: ClientSafeSource[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const label =
      s.type === "pos_tool"
        ? "Shop report"
        : s.type === "git"
          ? "WAKA history"
          : s.type === "test"
            ? "WAKA test coverage"
            : s.type === "milestone"
              ? "WAKA milestone"
              : s.type === "doc"
                ? "WAKA documentation"
                : "WAKA source";
    const title =
      s.type === "git"
        ? [s.date, s.title].filter(Boolean).join(" · ")
        : s.type === "pos_tool"
          ? "Shop report"
          : s.title && !s.title.includes("/")
            ? s.title
            : label;
    const id = s.chunk_id ?? `${s.type}:${label}:${title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      type: s.type as ClientSafeSource["type"],
      title,
      label,
      date: s.date,
      status: s.status,
      chunk_id: s.chunk_id,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function formatClientSafeCitation(source: ClientSafeSource): string {
  if (source.type === "git") return [source.label, source.title].filter(Boolean).join(" · ");
  if (source.type === "pos_tool") return source.label;
  if (source.status && source.status !== "UNDECLARED") return `${source.label} [${source.status}]`;
  return source.label;
}

export function ensureDisclosureLead(answer: string, lead: string): string {
  const trimmed = answer.trim();
  if (trimmed.toLowerCase().includes(lead.slice(0, 24).toLowerCase())) return trimmed;
  return `${lead}\n\n${trimmed}`.trim();
}
