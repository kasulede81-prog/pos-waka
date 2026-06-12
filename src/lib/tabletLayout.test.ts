import { describe, expect, it } from "vitest";
import { TABLET_SIDEBAR_MIN_PX, usesTabletSidebar } from "./tabletLayout";

describe("tablet layout", () => {
  it("uses sidebar navigation from 768px", () => {
    expect(TABLET_SIDEBAR_MIN_PX).toBe(768);
    expect(usesTabletSidebar(767)).toBe(false);
    expect(usesTabletSidebar(768)).toBe(true);
    expect(usesTabletSidebar(1024)).toBe(true);
  });
});
