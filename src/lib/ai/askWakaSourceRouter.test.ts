import { describe, expect, it } from "vitest";
import { ASK_WAKA_WRITE_TOOLS } from "./askWakaToolContracts";
import { routeAskWakaSources } from "./askWakaSourceRouter";

describe("ASK-INTEL-1 source router — knowledge-lane detection (unchanged)", () => {
  it("A: project questions route to PROJECT for knowledge retrieval", () => {
    const r = routeAskWakaSources("What is WAKA?");
    expect(r.lanes).toContain("PROJECT");
    expect(r.needsKnowledge).toBe(true);
    expect(r.refuse).toBe(false);
  });

  it("B: code questions route to CODE for knowledge retrieval", () => {
    const r = routeAskWakaSources("How does finalizeDraftSale work?");
    expect(r.lanes).toContain("CODE");
    expect(r.needsKnowledge).toBe(true);
  });

  it("C: history questions route to HISTORY, not sales", () => {
    const r = routeAskWakaSources("What did we work on in June 2026?");
    expect(r.lanes).toContain("HISTORY");
  });

  it("D: live POS questions are still classified quantitative and force-required", () => {
    const r = routeAskWakaSources("How much did we sell today?");
    expect(r.lanes).toEqual(["LIVE_POS"]);
    expect(r.offerPosTools).toBe(true);
    expect(r.requirePosTools).toBe(true);
    expect(r.needsKnowledge).toBe(false);
    expect(r.posClassification.requiredTools).toContain("get_today_sales");
  });

  it("D2: June sales stays LIVE_POS and does not become Git history", () => {
    const r = routeAskWakaSources("How much did we sell in June 2026?");
    expect(r.lanes).toContain("LIVE_POS");
    expect(r.lanes).not.toContain("HISTORY");
    expect(r.needsKnowledge).toBe(false);
  });

  it("E: refund remains ACTION refuse — the one thing that still hard-blocks tool offering", () => {
    const r = routeAskWakaSources("Refund this sale.");
    expect(r.lanes).toEqual(["ACTION"]);
    expect(r.refuse).toBe(true);
    expect(r.actionKind).toBe("write");
    expect(r.offerPosTools).toBe(false);
  });

  it("E2: SQL remains ACTION refuse", () => {
    const r = routeAskWakaSources("Run this SQL: SELECT * FROM sales");
    expect(r.refuse).toBe(true);
    expect(r.actionKind).toBe("sql");
    expect(r.offerPosTools).toBe(false);
  });

  it("MB-1 is a project question", () => {
    const r = routeAskWakaSources("Why did we introduce MB-1?");
    expect(r.needsKnowledge).toBe(true);
    expect(r.lanes.some((l) => l === "PROJECT" || l === "HISTORY" || l === "CODE")).toBe(true);
  });

  it("general questions are not refused as out-of-scope by the new router", () => {
    const r = routeAskWakaSources("Explain dependency injection.");
    expect(r.refuse).toBe(false);
    expect(r.lanes).toContain("GENERAL");
  });

  it("does not add write tools", () => {
    expect(ASK_WAKA_WRITE_TOOLS).toEqual([]);
  });
});

/**
 * ASK-4A.1 — the actual architecture correction.
 *
 * Phase 4A fixed the symptom (added phrases to looksLivePosMetric so specific
 * business questions reached tools) but left the underlying defect in place:
 * offerPosTools was still computed from a keyword/lane match. This phase
 * removes that gate entirely. offerPosTools is now `true` for every request
 * that passes safety classification — the only two exceptions are the
 * write/SQL short-circuits, which return their own object with
 * offerPosTools:false BEFORE any of this lane logic runs at all. There is no
 * third exclusion, and no phrase list of any kind decides this value anymore.
 *
 * This is why tests A/B/C/MB-1/"general questions" above no longer assert
 * offerPosTools===false the way they did pre-ASK-4A.1: that assertion was
 * testing the exact defect this phase exists to remove. What they still
 * correctly assert is the KNOWLEDGE lane (PROJECT/CODE/HISTORY), which is
 * untouched and remains keyword-based — that lane governs WAKA-knowledge
 * retrieval only, never POS tool availability.
 */
describe("ASK-4A.1: POS tool eligibility is safety-based, not topic/phrase-based", () => {
  it("every non-refused request offers the full POS tool set, regardless of topic", () => {
    const anyLegitimateQuestion = [
      "What is WAKA?",
      "How does finalizeDraftSale work?",
      "What did we work on in June 2026?",
      "Explain dependency injection.",
      "Why did we introduce MB-1?",
      "What is compound interest?",
      "How much did we sell today?",
      "Hello",
    ];
    for (const q of anyLegitimateQuestion) {
      expect(routeAskWakaSources(q).offerPosTools, q).toBe(true);
    }
  });

  it("only the write/SQL safety short-circuits withhold tools — nothing else does", () => {
    expect(routeAskWakaSources("Delete today's last sale.").offerPosTools).toBe(false);
    expect(routeAskWakaSources("Change the price of sugar.").offerPosTools).toBe(false);
    expect(routeAskWakaSources("Run SQL against my sales table.").offerPosTools).toBe(false);
    expect(routeAskWakaSources("Give me the raw database query.").offerPosTools).toBe(false);
  });

  it("requirePosTools (force-exec) still only fires for genuinely quantitative questions — offering is not forcing", () => {
    // A pure knowledge/general question gets tools OFFERED but is never forced to call one.
    expect(routeAskWakaSources("What is compound interest?").requirePosTools).toBe(false);
    expect(routeAskWakaSources("What is WAKA?").requirePosTools).toBe(false);
    // A genuinely quantitative question still force-execs exactly as before.
    expect(routeAskWakaSources("How much did we sell today?").requirePosTools).toBe(true);
  });

  it("the acceptance test: a NOVEL business question, never added to any phrase list, still reaches tools", () => {
    // Deliberately not present in looksLivePosMetric or any classifier keyword
    // list — proves eligibility no longer depends on matching a known phrase.
    const novel = routeAskWakaSources(
      "Considering everything you know about my shop, is there anything unusual going on this week?",
    );
    expect(novel.refuse).toBe(false);
    expect(novel.offerPosTools).toBe(true);
  });

  it("the 10 required open-ended business questions all reach tools (now true unconditionally, not via a phrase match)", () => {
    const questions = [
      "How is my shop doing?",
      "How is my shop doing today?",
      "Anything I should worry about?",
      "What should I focus on in my business?",
      "Why do my sales feel lower?",
      "Which products need attention?",
      "Show me yesterday's sold items.",
      "What happened in my business yesterday?",
      "Give me my shift report.",
      "Who is selling the most?",
    ];
    for (const q of questions) {
      const r = routeAskWakaSources(q);
      expect(r.offerPosTools, q).toBe(true);
      expect(r.refuse, q).toBe(false);
    }
  });

  it("write/SQL/refusal safety short-circuits are completely unaffected by broader tool eligibility", () => {
    const write = routeAskWakaSources("Delete today's sale.");
    expect(write.refuse).toBe(true);
    expect(write.actionKind).toBe("write");

    const priceChange = routeAskWakaSources("Change the price of sugar.");
    expect(priceChange.refuse).toBe(true);
    expect(priceChange.actionKind).toBe("write");

    const sql = routeAskWakaSources("Run SQL against my sales table.");
    expect(sql.refuse).toBe(true);
    expect(sql.actionKind).toBe("sql");
  });
});
