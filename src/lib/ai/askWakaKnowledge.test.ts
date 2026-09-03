import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASK_WAKA_KNOWLEDGE_LIMITS,
  ASK_WAKA_KNOWLEDGE_NOT_FOUND,
  knowledgeContainsLivePosPayload,
  mergeAskWakaSources,
  retrieveWakaKnowledge,
  shouldShortCircuitKnowledgeNotFound,
  type WakaKnowledgeArtifact,
} from "./askWakaKnowledge";
import { buildAskWakaUserPrompt } from "./askWakaPrompts";
import { routeAskWakaSources } from "./askWakaSourceRouter";
import { ASK_WAKA_TOOL_NAMES, ASK_WAKA_WRITE_TOOLS } from "./askWakaToolContracts";

const fixture: WakaKnowledgeArtifact = {
  version: 1,
  generated_at: "2026-09-03T00:00:00.000Z",
  head: "abc123",
  branch: "main",
  docs: [
    {
      path: "README.md",
      title: "Waka POS",
      status: "CURRENT",
      headings: ["Quick start"],
      excerpt: "Offline-first point of sale for Uganda shops.",
    },
    {
      path: "docs/PHASE_MB1_PLAN.md",
      title: "MB-1 shop namespace plan",
      status: "PLANNED",
      headings: ["Goals"],
      excerpt: "Planned account+shop persistence namespaces.",
    },
    {
      path: "docs/PHASE_MB1_CERTIFICATION.md",
      title: "MB-1 accepted",
      status: "ACCEPTED",
      headings: ["Namespace"],
      excerpt: "MB-1 introduced sb:userId:shopUuid isolation so shops do not share local data.",
    },
    {
      path: "docs/OLD_DRAWER.md",
      title: "Old drawer notes",
      status: "DEPRECATED",
      headings: [],
      excerpt: "Historical drawer formula that is no longer current.",
    },
  ],
  commits: [
    {
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      date: "2026-06-15T12:00:00.000Z",
      subject: "Implement MB-1 shop persistence namespace",
      files: ["src/offline/shopScope.ts"],
      milestone: "MB-1",
    },
    {
      hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      date: "2026-08-02T12:00:00.000Z",
      subject: "Home dashboard polish",
      files: ["src/pages/HomePage.tsx"],
    },
  ],
  code: [
    {
      path: "src/offline/shopScope.ts",
      kind: "code",
      symbols: ["getPersistenceNamespace", "buildPersistenceNamespace"],
      excerpt: "MB-1 — sb:<userId>:<shopId> persistence namespace.",
      tests: ["src/lib/mb1BranchSafePartition.test.ts"],
    },
    {
      path: "src/store/posStore.ts",
      kind: "code",
      symbols: ["finalizeDraftSale"],
      excerpt: "finalizeDraftSale commits the draft cart to an immutable sale.",
      tests: [],
    },
  ],
};

describe("ASK-INTEL-1 knowledge retrieval", () => {
  it("F: WAKA-specific answers require retrieval evidence", () => {
    const route = routeAskWakaSources("How does finalizeDraftSale work?");
    const result = retrieveWakaKnowledge("How does finalizeDraftSale work?", route.lanes, fixture);
    expect(result.found).toBe(true);
    expect(result.sources.some((s) => s.symbol === "finalizeDraftSale" || s.path?.includes("posStore"))).toBe(true);
  });

  it("G: no-retrieval WAKA claim becomes not-found short-circuit", () => {
    const lanes = ["CODE"] as const;
    const result = retrieveWakaKnowledge("Where is totallyMissingSymbolXYZ implemented?", lanes, fixture);
    expect(result.found).toBe(false);
    expect(shouldShortCircuitKnowledgeNotFound(lanes, result.found)).toBe(true);
    expect(ASK_WAKA_KNOWLEDGE_NOT_FOUND.toLowerCase()).toContain("couldn't find");
  });

  it("H: source records/citations are preserved without excerpts on the client record", () => {
    const result = retrieveWakaKnowledge("Why did we introduce MB-1?", ["PROJECT", "HISTORY"], fixture);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.every((s) => !("excerpt" in s) || (s as { excerpt?: string }).excerpt == null)).toBe(true);
    expect(result.hits.every((h) => h.excerpt.length > 0)).toBe(true);
  });

  it("I: document status filtering prefers CURRENT/ACCEPTED for now-questions", () => {
    const now = retrieveWakaKnowledge("What is the current MB-1 namespace architecture?", ["PROJECT"], fixture);
    const statuses = now.hits.filter((h) => h.type === "doc" || h.type === "milestone").map((h) => h.status);
    expect(statuses).toContain("ACCEPTED");
    const planned = now.hits.find((h) => h.path === "docs/PHASE_MB1_PLAN.md");
    const accepted = now.hits.find((h) => h.path === "docs/PHASE_MB1_CERTIFICATION.md");
    if (planned && accepted) {
      expect(accepted.relevance ?? 0).toBeGreaterThan(planned.relevance ?? 0);
    }
  });

  it("J: historical vs current — June 2026 git hits do not include August commits", () => {
    const result = retrieveWakaKnowledge("What did we work on in June 2026?", ["HISTORY"], fixture, {
      nowIso: "2026-09-03T00:00:00.000Z",
    });
    expect(result.found).toBe(true);
    expect(result.hits.some((h) => h.commit === "aaaaaaaaaaaa")).toBe(true);
    expect(result.hits.some((h) => h.commit === "bbbbbbbbbbbb")).toBe(false);
  });

  it("K: secret/path exclusions are encoded in the generator contract", () => {
    const gen = readFileSync(resolve(process.cwd(), "scripts/generate-waka-knowledge.mjs"), "utf8");
    expect(gen).toMatch(/\.env/);
    expect(gen).toContain("node_modules");
    expect(gen).toContain("PRIVATE KEY");
    expect(gen).toContain(".temp");
    expect(gen).toContain("supabase");
  });

  it("L: live POS context stays shop-bound in the prompt, separate from knowledge", () => {
    const prompt = JSON.parse(
      buildAskWakaUserPrompt({
        message: "How much did we sell today?",
        shopId: "11111111-1111-4111-8111-111111111111",
        dataAsOf: "2026-09-03T00:00:00.000Z",
        lanes: ["LIVE_POS"],
        retrievedKnowledge: "",
        knowledgeFound: false,
      }),
    ) as { shop_context: { shop_id: string }; retrieved_knowledge: string };
    expect(prompt.shop_context.shop_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(prompt.retrieved_knowledge).toBe("");
  });

  it("M: project knowledge does not contain live POS payloads", () => {
    expect(knowledgeContainsLivePosPayload(fixture)).toBe(false);
    const merged = mergeAskWakaSources(retrieveWakaKnowledge("What is WAKA?", ["PROJECT"], fixture).sources, [
      {
        type: "pos_tool",
        title: "Shop report",
        tool: "get_today_sales",
        chunk_id: "pos:get_today_sales",
      },
    ]);
    expect(merged.some((s) => s.type === "pos_tool")).toBe(true);
    expect(retrieveWakaKnowledge("What is WAKA?", ["PROJECT"], fixture).sources.every((s) => s.type !== "pos_tool")).toBe(
      true,
    );
  });

  it("N: mutation tools remain empty", () => {
    expect(ASK_WAKA_WRITE_TOOLS).toEqual([]);
  });

  it("P: existing 10 POS tools remain unchanged", () => {
    expect(ASK_WAKA_TOOL_NAMES).toEqual([
      "get_today_sales",
      "get_sales_for_period",
      "get_week_comparison",
      "get_top_products",
      "get_slow_products",
      "get_inventory_summary",
      "get_low_stock_products",
      "get_expense_summary",
      "get_customer_summary",
      "get_staff_sales_summary",
    ]);
  });

  it("retrieval stays bounded", () => {
    const result = retrieveWakaKnowledge("What have we built so far?", ["PROJECT", "HISTORY"], fixture);
    expect(result.context.length).toBeLessThanOrEqual(ASK_WAKA_KNOWLEDGE_LIMITS.maxContextChars);
    expect(result.sources.length).toBeLessThanOrEqual(ASK_WAKA_KNOWLEDGE_LIMITS.maxSources);
  });
});

describe("ASK-INTEL-1 generated artifact", () => {
  const artifact = JSON.parse(
    readFileSync(resolve(process.cwd(), "supabase/functions/_shared/wakaKnowledgeArtifact.json"), "utf8"),
  ) as WakaKnowledgeArtifact;

  it("indexes docs, git, and allowlisted source without live POS payloads", () => {
    expect(artifact.docs.length).toBeGreaterThan(50);
    expect(artifact.commits.length).toBeGreaterThan(50);
    expect(artifact.code.length).toBeGreaterThan(100);
    expect(knowledgeContainsLivePosPayload(artifact)).toBe(false);
    expect(artifact.docs.some((d) => d.path.includes(".env"))).toBe(false);
    expect(artifact.code.some((c) => c.path.includes("node_modules"))).toBe(false);
    expect(artifact.code.some((c) => c.path.includes("supabase/.temp"))).toBe(false);
  });

  it("can retrieve June 2026 engineering work from git metadata", () => {
    const result = retrieveWakaKnowledge("What did we work on in June 2026?", ["HISTORY"], artifact, {
      nowIso: "2026-09-03T00:00:00.000Z",
    });
    expect(result.found).toBe(true);
    expect(result.hits.some((h) => h.type === "git" && h.date?.startsWith("2026-06"))).toBe(true);
  });

  it("can locate finalizeDraftSale and shopScope", () => {
    const sale = retrieveWakaKnowledge("Where is finalizeDraftSale implemented?", ["CODE"], artifact);
    expect(sale.found).toBe(true);
    expect(sale.hits.some((h) => h.symbol === "finalizeDraftSale")).toBe(true);

    const engine = retrieveWakaKnowledge("How does saleFinancialEngine work?", ["CODE"], artifact);
    expect(engine.found).toBe(true);
    expect(
      engine.hits.some(
        (h) => (h.path ?? "").includes("saleFinancialEngine") && !(h.path ?? "").includes(".test."),
      ),
    ).toBe(true);

    const scope = retrieveWakaKnowledge("Where is shopScope implemented?", ["CODE"], artifact);
    expect(scope.found).toBe(true);
    expect(scope.hits.some((h) => (h.path ?? "").includes("shopScope"))).toBe(true);
  });

  it("does not classify undeclared docs as CURRENT", () => {
    expect(artifact.docs.every((d) => d.status !== "CURRENT" || /README|deployment|android\.md/i.test(d.path))).toBe(
      true,
    );
  });
});
