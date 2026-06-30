import { describe, expect, it } from "vitest";
import { mapPool } from "./asyncPool";

describe("mapPool", () => {
  it("runs all items with limited concurrency", async () => {
    const order: number[] = [];
    const { ok, fail } = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      order.push(n);
      return n % 2 === 1;
    });
    expect(order.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(ok).toBe(3);
    expect(fail).toBe(2);
  });
});
