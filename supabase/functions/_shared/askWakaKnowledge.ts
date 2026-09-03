/**
 * ASK-INTEL-1 deterministic WAKA knowledge retrieval.
 * Operates over a generated read-only artifact. No filesystem, SQL, or Git at request time.
 */

import type { AskWakaSourceLane } from "./askWakaSourceRouter.ts";
import type { WakaRelationship, WakaSymbolRecord } from "./askWakaCodeIntel.ts";
import { formatClientSafeCitation, toClientSafeSources } from "./askWakaCodeIntel.ts";

export const ASK_WAKA_KNOWLEDGE_NOT_FOUND =
  "I couldn't find that in the indexed WAKA project knowledge.";

export const ASK_WAKA_KNOWLEDGE_LIMITS = {
  topKDocs: 6,
  topKCode: 6,
  topKGit: 12,
  topKTests: 3,
  maxExcerptChars: 900,
  maxContextChars: 14_000,
  maxSources: 8,
} as const;

export type WakaDocStatus =
  | "PLANNED"
  | "IMPLEMENTED"
  | "AUDITED"
  | "ACCEPTED"
  | "FROZEN"
  | "PAUSED"
  | "DEPRECATED"
  | "CURRENT"
  | "UNDECLARED";

export type AskWakaSourceType = "doc" | "code" | "git" | "test" | "milestone" | "pos_tool";

export type AskWakaSourceRecord = {
  type: AskWakaSourceType;
  title: string;
  path?: string;
  commit?: string;
  date?: string;
  status?: WakaDocStatus;
  symbol?: string;
  relevance?: number;
  chunk_id?: string;
  period?: string;
  tool?: string;
};

export type WakaKnowledgeHit = AskWakaSourceRecord & { excerpt: string };

export type WakaDocRecord = {
  path: string;
  title: string;
  status: WakaDocStatus;
  headings: string[];
  excerpt: string;
};

export type WakaCommitRecord = {
  hash: string;
  date: string;
  subject: string;
  files: string[];
  milestone?: string;
};

export type WakaCodeRecord = {
  path: string;
  kind: "code" | "test";
  language?: string;
  category?: string;
  symbols: string[];
  symbolMeta?: Array<{ name: string; kind: string; exported: boolean }>;
  imports?: string[];
  callees?: string[];
  excerpt: string;
  tests: string[];
};

export type WakaKnowledgeArtifact = {
  version: 1 | 2;
  generated_at: string;
  head: string;
  branch: string;
  docs: WakaDocRecord[];
  commits: WakaCommitRecord[];
  code: WakaCodeRecord[];
  symbols?: WakaSymbolRecord[];
  relationships?: WakaRelationship[];
};

export type WakaKnowledgeRetrieval = {
  hits: WakaKnowledgeHit[];
  sources: AskWakaSourceRecord[];
  clientSources: ReturnType<typeof toClientSafeSources>;
  context: string;
  found: boolean;
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** Curated aliases — not month-specific answers. */
export const WAKA_KNOWLEDGE_ALIASES: Record<string, readonly string[]> = {
  "mb-1": ["mb1", "shopscope", "shop scope", "persistence namespace", "sb:userid", "account+shop"],
  mb1: ["mb-1", "shopscope", "persistence namespace"],
  shopscope: ["getpersistencenamespace", "buildpersistencenamespace", "mb-1", "active shop"],
  finalizedraftsale: ["finalize draft", "complete sale", "sale flow", "pos store"],
  "sale flow": ["finalizedraftsale", "salefinancialengine"],
  salefinancialengine: ["sale financial", "financial engine", "canonical revenue"],
  "cash drawer": ["drawerv2", "drawer v2", "cash position", "day open"],
  "cash position": ["drawerv2", "cash drawer"],
  "device authorization": ["device isolation", "hardware authorization", "device authority"],
  permissions: ["sensitiveactiongate", "role", "store authorization"],
  "active shop": ["getactiveshopid", "setactiveshopid", "shopscope"],
  "ask waka": ["ai-ask-waka", "askwaka"],
};

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "from", "what", "when", "where", "which",
  "how", "does", "did", "are", "was", "were", "have", "has", "been", "into", "about",
  "your", "our", "you", "we", "a", "an", "in", "on", "of", "to", "is", "it", "or",
]);

export function expandWakaKnowledgeQuery(message: string): string[] {
  const raw = message.trim().toLowerCase();
  const terms = tokenize(raw);
  const extra: string[] = [];
  for (const [alias, expansions] of Object.entries(WAKA_KNOWLEDGE_ALIASES)) {
    if (raw.includes(alias) || terms.includes(alias)) {
      extra.push(alias, ...expansions);
    }
  }
  if (/\bfinalizedraftsale\b/i.test(message) || raw.includes("finalize draft") || raw.includes("complete a sale")) {
    extra.push("finalizedraftsale", "finalize");
  }
  if (/\bsalefinancialengine\b/i.test(message) || raw.includes("sale financial")) {
    extra.push("salefinancialengine");
  }
  return [...new Set([...terms, ...extra.map((t) => t.toLowerCase())])]
    .filter((t) => t.length >= 2)
    .flatMap((t) => (t.endsWith("s") && t.length > 4 ? [t, t.slice(0, -1)] : [t]));
}

const WEAK_TERMS = new Set([
  "implemented",
  "implementation",
  "function",
  "functions",
  "file",
  "files",
  "code",
  "source",
  "work",
  "works",
  "working",
  "please",
  "show",
  "tested",
  "testing",
  "coverage",
]);

function distinctiveTerms(terms: readonly string[]): string[] {
  return terms.filter((t) => t.length >= 5 && !WEAK_TERMS.has(t));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9:._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export function parseProjectDateRange(
  message: string,
  nowIso: string,
): { startMs: number; endMs: number; label: string } | null {
  const text = message.toLowerCase();
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return null;

  if (/\brecently\b/.test(text) || /\bwhat changed recently\b/.test(text)) {
    const start = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
    return { startMs: start.getTime(), endMs: now.getTime(), label: "recent" };
  }

  if (/\blast month\b/.test(text)) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    return { startMs: start.getTime(), endMs: end.getTime(), label: "last_month" };
  }

  const yearMatch = text.match(/\b(20\d{2})\b/);
  let monthIdx: number | null = null;
  for (const [name, idx] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) {
      monthIdx = idx;
      break;
    }
  }
  if (monthIdx == null && !yearMatch) return null;
  const year = yearMatch ? Number(yearMatch[1]) : now.getUTCFullYear();
  if (monthIdx == null) {
    return {
      startMs: Date.UTC(year, 0, 1),
      endMs: Date.UTC(year, 11, 31, 23, 59, 59, 999),
      label: String(year),
    };
  }
  return {
    startMs: Date.UTC(year, monthIdx, 1),
    endMs: Date.UTC(year, monthIdx + 1, 0, 23, 59, 59, 999),
    label: `${year}-${String(monthIdx + 1).padStart(2, "0")}`,
  };
}

function haystackForDoc(doc: WakaDocRecord): string {
  return `${doc.path} ${doc.title} ${doc.status} ${doc.headings.join(" ")} ${doc.excerpt}`.toLowerCase();
}

function haystackForCode(row: WakaCodeRecord): string {
  return `${row.path} ${row.symbols.join(" ")} ${row.excerpt}`.toLowerCase();
}

function haystackForCommit(row: WakaCommitRecord): string {
  return `${row.hash} ${row.subject} ${row.files.join(" ")} ${row.milestone ?? ""}`.toLowerCase();
}

function scoreTerms(haystack: string, terms: readonly string[]): number {
  let score = 0;
  for (const term of terms) {
    if (term.length < 2) continue;
    if (haystack.includes(term)) score += term.length >= 6 ? 3 : 2;
  }
  return score;
}

function wantsCurrentState(message: string): boolean {
  const t = message.toLowerCase();
  return (
    includesAny(t, [
      "how does waka work now",
      "current architecture",
      "currently",
      "right now",
      "today's architecture",
      "what does waka do now",
      "current implementation",
    ]) || /\bcurrent\b/.test(t)
  );
}

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => text.includes(n));
}

function statusWeight(status: WakaDocStatus, preferCurrent: boolean): number {
  if (status === "DEPRECATED" || status === "PAUSED") return preferCurrent ? 0.15 : 0.5;
  if (status === "PLANNED") return preferCurrent ? 0.25 : 0.8;
  if (status === "UNDECLARED") return preferCurrent ? 0.45 : 0.7;
  if (status === "AUDITED") return preferCurrent ? 0.7 : 1;
  if (status === "IMPLEMENTED") return 1;
  if (status === "FROZEN" || status === "ACCEPTED" || status === "CURRENT") return preferCurrent ? 1.35 : 1.1;
  return 1;
}

function clipExcerpt(text: string, max: number = ASK_WAKA_KNOWLEDGE_LIMITS.maxExcerptChars): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function toSource(hit: WakaKnowledgeHit): AskWakaSourceRecord {
  const { excerpt: _excerpt, ...rest } = hit;
  void _excerpt;
  return rest;
}

export function retrieveWakaKnowledge(
  message: string,
  lanes: readonly AskWakaSourceLane[],
  artifact: WakaKnowledgeArtifact,
  opts?: { nowIso?: string },
): WakaKnowledgeRetrieval {
  const terms = expandWakaKnowledgeQuery(message);
  const preferCurrent = wantsCurrentState(message);
  const nowIso = opts?.nowIso ?? artifact.generated_at;
  const historyRange = lanes.includes("HISTORY") ? parseProjectDateRange(message, nowIso) : null;

  const hits: WakaKnowledgeHit[] = [];

  if (lanes.includes("PROJECT") || lanes.includes("HISTORY")) {
    const ranked = artifact.docs
      .map((doc) => {
        let s = scoreTerms(haystackForDoc(doc), terms) * statusWeight(doc.status, preferCurrent);
        if (/\bmilestone\b/.test(message.toLowerCase()) && /phase_|milestone|certification/.test(doc.path.toLowerCase())) {
          s += 4;
        }
        if (/\bfrozen\b/.test(message.toLowerCase()) && (doc.status === "FROZEN" || /frozen/.test(doc.path.toLowerCase()))) {
          s += 8;
        }
        return { doc, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, ASK_WAKA_KNOWLEDGE_LIMITS.topKDocs);

    for (const { doc, s } of ranked) {
      hits.push({
        type: /phase_|milestone/i.test(doc.path) ? "milestone" : "doc",
        title: doc.title,
        path: doc.path,
        status: doc.status,
        relevance: s,
        chunk_id: `doc:${doc.path}`,
        excerpt: clipExcerpt(doc.excerpt),
      });
    }
  }

  if (lanes.includes("CODE") || lanes.includes("PROJECT")) {
    const distinctive = distinctiveTerms(terms);
    const requireDistinctive = lanes.includes("CODE") && distinctive.length > 0;
    const exactNames = new Set(
      (artifact.symbols ?? []).filter((s) =>
        terms.includes(s.name.toLowerCase()) || message.includes(s.name),
      ).map((s) => s.name.toLowerCase()),
    );

    const ranked = artifact.code
      .map((row) => {
        const hay = haystackForCode(row);
        if (requireDistinctive && !distinctive.some((t) => hay.includes(t))) {
          return { row, s: 0 };
        }
        let s = scoreTerms(hay, terms);
        const msg = message.trim();
        for (const sym of row.symbols) {
          if (msg.includes(sym) || terms.includes(sym.toLowerCase())) s += 14;
          if (exactNames.has(sym.toLowerCase())) s += 18;
        }
        if (terms.some((t) => row.path.toLowerCase().includes(t))) s += 6;
        return { row, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    const codeHits = ranked.filter((x) => x.row.kind === "code").slice(0, ASK_WAKA_KNOWLEDGE_LIMITS.topKCode);
    const testHits = ranked.filter((x) => x.row.kind === "test").slice(0, ASK_WAKA_KNOWLEDGE_LIMITS.topKTests);

    if (exactNames.size) {
      const byPath = new Map(codeHits.map((x) => [x.row.path, x]));
      for (const rec of artifact.symbols ?? []) {
        if (!exactNames.has(rec.name.toLowerCase())) continue;
        if (rec.file.includes(".test.")) continue;
        if (byPath.has(rec.file)) continue;
        const row = artifact.code.find((c) => c.path === rec.file && c.kind === "code");
        if (!row) continue;
        byPath.set(rec.file, { row, s: 40 });
      }
      codeHits.length = 0;
      codeHits.push(
        ...[...byPath.values()]
          .sort((a, b) => b.s - a.s)
          .slice(0, ASK_WAKA_KNOWLEDGE_LIMITS.topKCode),
      );
    }

    const relatedPaths = new Set<string>();
    const relatedSymbols = new Set<string>();
    const seedPaths = new Set(codeHits.map((x) => x.row.path));
    for (const rel of artifact.relationships ?? []) {
      if (seedPaths.has(rel.from) || seedPaths.has(rel.to)) {
        if (rel.kind === "call" || rel.kind === "import") {
          relatedSymbols.add(rel.to);
          relatedPaths.add(rel.from);
          relatedPaths.add(rel.to);
        }
        if (rel.kind === "test") relatedPaths.add(rel.to);
        if (rel.kind === "doc") relatedPaths.add(rel.to);
      }
    }

    for (const { row, s } of [...codeHits, ...testHits]) {
      const matched = row.symbols.find((sym) => message.includes(sym) || terms.includes(sym.toLowerCase()));
      hits.push({
        type: row.kind === "test" ? "test" : "code",
        title: matched ?? row.path.split("/").pop() ?? row.path,
        path: row.path,
        symbol: matched,
        relevance: s,
        chunk_id: `code:${row.path}`,
        excerpt: clipExcerpt(row.excerpt, 320),
      });
      for (const t of row.tests) relatedPaths.add(t);
    }

    if (/\b(tested|test coverage|are there tests)\b/.test(message.toLowerCase())) {
      for (const { row, s } of codeHits) {
        for (const testPath of row.tests) {
          const testRow = artifact.code.find((c) => c.path === testPath);
          if (!testRow || hits.some((h) => h.path === testPath)) continue;
          hits.push({
            type: "test",
            title: testRow.symbols[0] ?? testPath.split("/").pop() ?? testPath,
            path: testRow.path,
            relevance: s,
            chunk_id: `test:${testRow.path}`,
            excerpt: clipExcerpt(testRow.excerpt, 320),
          });
        }
      }
    }

    if (lanes.includes("CODE") || lanes.includes("PROJECT")) {
      for (const row of artifact.code) {
        if (hits.length >= ASK_WAKA_KNOWLEDGE_LIMITS.topKCode + ASK_WAKA_KNOWLEDGE_LIMITS.topKTests + 4) break;
        if (!relatedPaths.has(row.path) && !row.symbols.some((sym) => relatedSymbols.has(sym))) continue;
        if (hits.some((h) => h.path === row.path)) continue;
        const matched = row.symbols.find((sym) => relatedSymbols.has(sym));
        hits.push({
          type: row.kind === "test" ? "test" : "code",
          title: matched ?? row.path.split("/").pop() ?? row.path,
          path: row.path,
          symbol: matched,
          relevance: 8,
          chunk_id: `rel:${row.path}`,
          excerpt: clipExcerpt(row.excerpt, 320),
        });
      }

      for (const doc of artifact.docs) {
        if (!relatedPaths.has(doc.path)) continue;
        if (hits.some((h) => h.path === doc.path)) continue;
        hits.push({
          type: /phase_|milestone/i.test(doc.path) ? "milestone" : "doc",
          title: doc.title,
          path: doc.path,
          status: doc.status,
          relevance: 7,
          chunk_id: `reldoc:${doc.path}`,
          excerpt: clipExcerpt(doc.excerpt),
        });
      }
    }

    const codePaths = hits.filter((h) => h.type === "code" || h.type === "test").map((h) => h.path).filter(Boolean);
    if (codePaths.length && (lanes.includes("CODE") || lanes.includes("HISTORY") || lanes.includes("PROJECT"))) {
      const fileHits = artifact.commits.filter((c) => c.files.some((f) => codePaths.includes(f))).slice(0, 4);
      for (const c of fileHits) {
        if (hits.some((h) => h.chunk_id === `git:${c.hash}`)) continue;
        hits.push({
          type: "git",
          title: c.subject,
          commit: c.hash.slice(0, 12),
          date: c.date.slice(0, 10),
          relevance: 6,
          chunk_id: `git:${c.hash}`,
          excerpt: clipExcerpt(`${c.date.slice(0, 10)} ${c.subject}`),
        });
      }
    }
  }

  if (lanes.includes("HISTORY") || lanes.includes("PROJECT")) {
    let commits = artifact.commits;
    if (historyRange) {
      commits = commits.filter((c) => {
        const t = Date.parse(c.date);
        return Number.isFinite(t) && t >= historyRange.startMs && t <= historyRange.endMs;
      });
    }
    const ranked = commits
      .map((c) => {
        let s = scoreTerms(haystackForCommit(c), terms);
        if (historyRange) s += 5;
        if (!terms.length && historyRange) s += 1;
        return { c, s };
      })
      .filter((x) => historyRange || x.s > 0)
      .sort((a, b) => {
        if (historyRange) return Date.parse(b.c.date) - Date.parse(a.c.date) || b.s - a.s;
        return b.s - a.s;
      })
      .slice(0, ASK_WAKA_KNOWLEDGE_LIMITS.topKGit);

    for (const { c, s } of ranked) {
      const files = c.files.slice(0, 12).join(", ");
      hits.push({
        type: "git",
        title: c.subject,
        commit: c.hash.slice(0, 12),
        date: c.date.slice(0, 10),
        path: files || undefined,
        relevance: s,
        chunk_id: `git:${c.hash}`,
        excerpt: clipExcerpt(`${c.date.slice(0, 10)} ${c.hash.slice(0, 12)} ${c.subject}. Files: ${files}`),
      });
    }
  }

  hits.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  const bounded = boundContext(hits);
  const sources = bounded.map(toSource).slice(0, ASK_WAKA_KNOWLEDGE_LIMITS.maxSources);
  const context = formatKnowledgeContext(bounded);
  return {
    hits: bounded,
    sources,
    clientSources: toClientSafeSources(sources),
    context,
    found: bounded.length > 0,
  };
}

function boundContext(hits: WakaKnowledgeHit[]): WakaKnowledgeHit[] {
  const out: WakaKnowledgeHit[] = [];
  let used = 0;
  for (const hit of hits) {
    const piece = hit.excerpt.length + (hit.path?.length ?? 0) + 80;
    if (used + piece > ASK_WAKA_KNOWLEDGE_LIMITS.maxContextChars) break;
    out.push(hit);
    used += piece;
    if (out.length >= ASK_WAKA_KNOWLEDGE_LIMITS.maxSources + 6) break;
  }
  return out;
}

export function formatKnowledgeContext(hits: readonly WakaKnowledgeHit[]): string {
  if (!hits.length) return "";
  return hits
    .map((h, i) => {
      const meta = [
        `id=${h.chunk_id}`,
        `type=${h.type}`,
        h.symbol ? `symbol=${h.symbol}` : null,
        h.status ? `status=${h.status}` : null,
        h.date ? `date=${h.date}` : null,
        h.commit ? `commit=${h.commit}` : null,
        `authority=${h.type === "git" ? "historical" : h.type === "code" || h.type === "test" ? "current-implementation" : "documentation"}`,
      ]
        .filter(Boolean)
        .join(" ");
      return `[${i + 1}] ${meta}\n${h.excerpt}`;
    })
    .join("\n\n");
}

export function knowledgeRequiresEvidence(lanes: readonly AskWakaSourceLane[]): boolean {
  return lanes.some((l) => l === "PROJECT" || l === "CODE" || l === "HISTORY");
}

export function shouldShortCircuitKnowledgeNotFound(
  lanes: readonly AskWakaSourceLane[],
  found: boolean,
): boolean {
  if (found) return false;
  if (!knowledgeRequiresEvidence(lanes)) return false;
  if (lanes.includes("LIVE_POS")) return false;
  if (lanes.includes("GENERAL") && !lanes.includes("CODE") && !lanes.includes("HISTORY")) {
    return false;
  }
  return lanes.includes("CODE") || lanes.includes("HISTORY") || (lanes.includes("PROJECT") && !lanes.includes("GENERAL"));
}

export function buildPosToolSourceRecords(params: {
  toolsUsed: readonly string[];
  dataAsOf: string;
  period?: string | null;
}): AskWakaSourceRecord[] {
  return params.toolsUsed.slice(0, 8).map((tool) => ({
    type: "pos_tool" as const,
    title: "Shop report",
    tool,
    date: params.dataAsOf,
    period: params.period ?? undefined,
    chunk_id: `pos:${tool}`,
  }));
}

export function mergeAskWakaSources(
  knowledge: readonly AskWakaSourceRecord[],
  pos: readonly AskWakaSourceRecord[],
): AskWakaSourceRecord[] {
  const out: AskWakaSourceRecord[] = [];
  const seen = new Set<string>();
  for (const s of [...knowledge, ...pos]) {
    const id = s.chunk_id ?? `${s.type}:${s.path ?? s.commit ?? s.tool ?? s.title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
    if (out.length >= ASK_WAKA_KNOWLEDGE_LIMITS.maxSources) break;
  }
  return out;
}

export function formatAskWakaSourceCitation(source: AskWakaSourceRecord): string {
  const safe = toClientSafeSources([source])[0];
  if (!safe) return "WAKA source";
  return formatClientSafeCitation(safe);
}

/** Project knowledge must never embed live POS tool payloads. Mentions of RPC names in source are expected. */
export function knowledgeContainsLivePosPayload(artifact: WakaKnowledgeArtifact): boolean {
  const blob = JSON.stringify(artifact);
  return (
    blob.includes("forced_tool_result") ||
    blob.includes('"week_is_rolling_seven_days":true') ||
    blob.includes('"empty_confirmed":true,"shop_id"')
  );
}
