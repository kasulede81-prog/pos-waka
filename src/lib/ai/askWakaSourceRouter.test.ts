import { describe, expect, it } from "vitest";
import { ASK_WAKA_WRITE_TOOLS } from "./askWakaToolContracts";
import { routeAskWakaSources } from "./askWakaSourceRouter";

describe("ASK-INTEL-1 source router", () => {
  it("A: project questions are not POS-tool routed", () => {
    const r = routeAskWakaSources("What is WAKA?");
    expect(r.lanes).toContain("PROJECT");
    expect(r.offerPosTools).toBe(false);
    expect(r.requirePosTools).toBe(false);
    expect(r.refuse).toBe(false);
    expect(r.needsKnowledge).toBe(true);
  });

  it("B: code questions route to CODE", () => {
    const r = routeAskWakaSources("How does finalizeDraftSale work?");
    expect(r.lanes).toContain("CODE");
    expect(r.offerPosTools).toBe(false);
    expect(r.needsKnowledge).toBe(true);
  });

  it("C: history questions route to HISTORY, not sales", () => {
    const r = routeAskWakaSources("What did we work on in June 2026?");
    expect(r.lanes).toContain("HISTORY");
    expect(r.lanes).not.toContain("LIVE_POS");
    expect(r.offerPosTools).toBe(false);
  });

  it("D: live POS questions remain POS-tool routed", () => {
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

  it("E: refund remains ACTION refuse", () => {
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
  });

  it("MB-1 is a project question", () => {
    const r = routeAskWakaSources("Why did we introduce MB-1?");
    expect(r.needsKnowledge).toBe(true);
    expect(r.offerPosTools).toBe(false);
    expect(r.lanes.some((l) => l === "PROJECT" || l === "HISTORY" || l === "CODE")).toBe(true);
  });

  it("general questions are not refused as out-of-scope by the new router", () => {
    const r = routeAskWakaSources("Explain dependency injection.");
    expect(r.refuse).toBe(false);
    expect(r.lanes).toContain("GENERAL");
    expect(r.offerPosTools).toBe(false);
  });

  it("does not add write tools", () => {
    expect(ASK_WAKA_WRITE_TOOLS).toEqual([]);
  });
});
