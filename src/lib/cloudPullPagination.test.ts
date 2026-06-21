import { describe, expect, it, vi } from "vitest";
import { pullCursorUntilExhausted, pullOffsetRangeUntilExhausted } from "./cloudPullPagination";

describe("cloudPullPagination", () => {
  it("pullOffsetRangeUntilExhausted stops when batch is smaller than page size", async () => {
    const fetchRange = vi.fn(async (offset: number) => {
      if (offset === 0) return [1, 2, 3];
      if (offset === 3) return [4];
      return [];
    });
    const rows = await pullOffsetRangeUntilExhausted({
      pageSize: 3,
      fetchRange,
    });
    expect(rows).toEqual([1, 2, 3, 4]);
    expect(fetchRange).toHaveBeenCalledTimes(2);
  });

  it("pullCursorUntilExhausted advances cursor until exhaustion", async () => {
    const pullPage = vi.fn(async (cursor: string) => {
      if (cursor === "0") return { rows: ["a", "b"], checkpointAt: "1", bytes: 10 };
      if (cursor === "1") return { rows: ["c"], checkpointAt: "2", bytes: 5 };
      return { rows: [], checkpointAt: "2", bytes: 0 };
    });
    const result = await pullCursorUntilExhausted({
      initialCursor: "0",
      pageSizeHint: 2,
      pullPage,
    });
    expect(result.rows).toEqual(["a", "b", "c"]);
    expect(result.bytes).toBe(15);
    expect(pullPage).toHaveBeenCalledTimes(2);
  });
});
