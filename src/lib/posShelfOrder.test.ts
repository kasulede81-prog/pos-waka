import { describe, expect, it } from "vitest";
import {
  effectiveShelfOrderKeys,
  sortPosShelfCards,
  togglePinnedShelfKey,
  movePinnedShelfKey,
} from "./posShelfOrder";

describe("posShelfOrder", () => {
  const cards = [
    { key: "A", label: "A", count: 1, icon: null },
    { key: "B", label: "B", count: 2, icon: null },
    { key: "C", label: "C", count: 3, icon: null },
  ];

  it("sorts shelves by saved shop order then name", () => {
    const sorted = sortPosShelfCards(cards, ["C", "A"]);
    expect(sorted.map((c) => c.key)).toEqual(["C", "A", "B"]);
  });

  it("appends new shelves alphabetically after saved order", () => {
    expect(effectiveShelfOrderKeys(["B", "A", "C"], ["C"])).toEqual(["C", "A", "B"]);
  });

  it("toggles pin keys", () => {
    expect(togglePinnedShelfKey(["A"], "B")).toEqual(["A", "B"]);
    expect(togglePinnedShelfKey(["A", "B"], "A")).toEqual(["B"]);
  });

  it("moves pinned shelf order", () => {
    expect(movePinnedShelfKey(["A", "B", "C"], "B", "up")).toEqual(["B", "A", "C"]);
    expect(movePinnedShelfKey(["A", "B", "C"], "B", "down")).toEqual(["A", "C", "B"]);
  });
});
