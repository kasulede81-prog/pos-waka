import { describe, expect, it } from "vitest";
import {
  clearSelection,
  selectFilteredResults,
  selectPage,
  toggleSelectionId,
} from "./InventorySelectionEngine";

describe("InventorySelectionEngine", () => {
  it("toggles ids and clears", () => {
    let state = toggleSelectionId(clearSelection({ selectedIds: new Set(), selectionMode: true, allFilteredSelected: false }), "a");
    expect(state.selectedIds.has("a")).toBe(true);
    state = toggleSelectionId(state, "a");
    expect(state.selectedIds.has("a")).toBe(false);
  });

  it("selects filtered results", () => {
    const state = selectFilteredResults(
      { selectedIds: new Set(), selectionMode: false, allFilteredSelected: false },
      ["a", "b", "c"],
    );
    expect(state.selectedIds.size).toBe(3);
    expect(state.allFilteredSelected).toBe(true);
    expect(state.selectionMode).toBe(true);
  });

  it("selects page without losing prior selection", () => {
    const base = { selectedIds: new Set(["x"]), selectionMode: true, allFilteredSelected: false };
    const state = selectPage(base, ["a", "b"]);
    expect(state.selectedIds.has("x")).toBe(true);
    expect(state.selectedIds.has("a")).toBe(true);
  });
});
