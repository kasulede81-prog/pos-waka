import { describe, expect, it } from "vitest";
import { mergeToggleAll, toggleIdInSet } from "./selectionHelpers";

describe("selectionHelpers", () => {
  it("toggles ids", () => {
    const a = toggleIdInSet(new Set(), "a", true);
    expect(a.has("a")).toBe(true);
    const b = toggleIdInSet(a, "a", false);
    expect(b.has("a")).toBe(false);
  });

  it("merges page select", () => {
    const next = mergeToggleAll(new Set(["x"]), ["a", "b"], true);
    expect([...next].sort()).toEqual(["a", "b", "x"]);
  });
});
