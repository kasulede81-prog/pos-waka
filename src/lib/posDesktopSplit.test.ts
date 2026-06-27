import { describe, expect, it } from "vitest";
import { posCheckoutColumnWidthPx, posSplitGridTemplateColumns } from "./posDesktopSplit";

describe("posDesktopSplit", () => {
  it("returns zero checkout width below full desktop threshold", () => {
    expect(posCheckoutColumnWidthPx(1023)).toBe(0);
  });

  it("uses narrower checkout on 1024×768 terminals", () => {
    const w = posCheckoutColumnWidthPx(1024);
    expect(w).toBeGreaterThanOrEqual(280);
    expect(w).toBeLessThanOrEqual(340);
  });

  it("allows checkout to grow on ultrawide displays", () => {
    const hd = posCheckoutColumnWidthPx(1920);
    const uhd = posCheckoutColumnWidthPx(3440);
    expect(uhd).toBeGreaterThan(hd);
    expect(uhd).toBeLessThanOrEqual(460);
  });

  it("builds grid template with fluid catalog column", () => {
    expect(posSplitGridTemplateColumns(1280)).toMatch(/^minmax\(0, 1fr\) \d+px$/);
  });
});
