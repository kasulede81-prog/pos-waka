import { describe, expect, it } from "vitest";
import { shallow } from "zustand/shallow";
import { usePosStore } from "../store/usePosStore";
import { resolveFloorDisplayPrefs, selectFloorPlanSlice } from "./floorDisplayPrefs";

describe("selectFloorPlanSlice — FloorPlanPage render-loop regression (React #185)", () => {
  it("is shallow-stable across calls on unchanged state (what useShallow needs)", () => {
    const state = usePosStore.getState();
    expect(shallow(selectFloorPlanSlice(state), selectFloorPlanSlice(state))).toBe(true);
  });

  it("stays shallow-stable when hospitalityFloorDisplay is set", () => {
    const base = usePosStore.getState();
    const state = {
      ...base,
      preferences: {
        ...base.preferences,
        hospitalityFloorDisplay: { tableShape: "round", tableSize: "lg", gridDensity: "compact" },
      },
    } as typeof base;
    const a = selectFloorPlanSlice(state);
    expect(shallow(a, selectFloorPlanSlice(state))).toBe(true);
    expect(a).toMatchObject({ tableShape: "round", tableSize: "lg", gridDensity: "compact" });
  });

  it("returns only primitives or existing store references (no fresh objects)", () => {
    const state = usePosStore.getState();
    const slice = selectFloorPlanSlice(state);
    expect(slice.rawFloor).toBe(state.preferences.hospitalityFloor);
    expect(slice.sales).toBe(state.sales);
    for (const key of ["businessType", "hospitalityModeEnabled", "tableShape", "tableSize", "gridDensity"] as const) {
      expect(typeof slice[key] === "object" && slice[key] !== null).toBe(false);
    }
  });

  it("falls back to the same defaults as resolveFloorDisplayPrefs", () => {
    const { preferences } = usePosStore.getState();
    const slice = selectFloorPlanSlice(usePosStore.getState());
    expect({ tableShape: slice.tableShape, tableSize: slice.tableSize, gridDensity: slice.gridDensity }).toEqual(
      resolveFloorDisplayPrefs(preferences),
    );
  });
});
