import { describe, expect, it } from "vitest";
import { orderNavByPaths, unifiedThirdNavPath } from "./unifiedNav";

describe("unifiedNav", () => {
  it("picks shop over stock when both could apply", () => {
    expect(unifiedThirdNavPath(true, true)).toBe("/office");
    expect(unifiedThirdNavPath(false, true)).toBe("/stock");
  });

  it("orders nav items by primary paths", () => {
    const items = [
      { path: "/office", label: "Shop" },
      { path: "/", label: "Menu" },
      { path: "/pos", label: "Sell" },
    ];
    expect(orderNavByPaths(items, ["/", "/pos", "/office"]).map((i) => i.path)).toEqual(["/", "/pos", "/office"]);
  });
});
