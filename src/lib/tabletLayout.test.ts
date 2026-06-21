import { describe, expect, it } from "vitest";
import { POS_DESKTOP_LAYOUT_MIN_PX, TABLET_SIDEBAR_MIN_PX, usesPosDesktopLayout, usesTabletSidebar } from "./tabletLayout";

describe("tablet layout", () => {
  it("uses sidebar navigation from 768px", () => {
    expect(TABLET_SIDEBAR_MIN_PX).toBe(768);
    expect(usesTabletSidebar(767)).toBe(false);
    expect(usesTabletSidebar(768)).toBe(true);
    expect(usesTabletSidebar(1024)).toBe(true);
  });

  it("uses POS desktop split from 768px", () => {
    expect(POS_DESKTOP_LAYOUT_MIN_PX).toBe(768);
    expect(usesPosDesktopLayout(767)).toBe(false);
    expect(usesPosDesktopLayout(768)).toBe(true);
    expect(usesPosDesktopLayout(884)).toBe(true);
  });
});
