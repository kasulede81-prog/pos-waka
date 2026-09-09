import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAdminShopsLoadMore, isCurrentAdminShopsRequest } from "./AdminShopsPage";

describe("AdminShopsPage load-more / new-search race", () => {
  it("discards a late load-more from search A after search B replaces the list", () => {
    let latestSeq = 0;

    latestSeq += 1;
    const searchASeq = latestSeq;
    let rows = ["A1", "A2"];

    const loadMoreASeq = searchASeq;
    expect(isCurrentAdminShopsRequest(loadMoreASeq, latestSeq)).toBe(true);

    latestSeq += 1;
    const searchBSeq = latestSeq;
    rows = ["B1"];
    expect(isCurrentAdminShopsRequest(searchASeq, latestSeq)).toBe(false);
    expect(isCurrentAdminShopsRequest(searchBSeq, latestSeq)).toBe(true);

    const lateA = applyAdminShopsLoadMore({
      startedSeq: loadMoreASeq,
      latestSeq,
      previous: rows,
      incoming: ["A3", "A4"],
    });

    expect(lateA.applied).toBe(false);
    expect(lateA.rows).toEqual(["B1"]);
    expect(lateA.rows).not.toContain("A3");
  });

  it("appends load-more only while the search generation is still current", () => {
    const merged = applyAdminShopsLoadMore({
      startedSeq: 4,
      latestSeq: 4,
      previous: ["A1", "A2"],
      incoming: ["A3"],
    });
    expect(merged.applied).toBe(true);
    expect(merged.rows).toEqual(["A1", "A2", "A3"]);
  });

  it("search reset and loadMore share the request-generation guard", () => {
    const src = readFileSync(join(process.cwd(), "src/components/internal-admin/v2/pages/AdminShopsPage.tsx"), "utf8");
    expect(src).toContain("const seq = ++requestSeq.current");
    expect(src).toContain("const seq = requestSeq.current");
    expect(src).toContain("isCurrentAdminShopsRequest(seq, requestSeq.current)");
    expect(src).toContain("if (!isCurrentAdminShopsRequest(seq, requestSeq.current)) return");
    expect(src).toContain("Status, plan, and district filter loaded results only.");
  });
});
