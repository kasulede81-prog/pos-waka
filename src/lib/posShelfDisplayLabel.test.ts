import { describe, expect, it } from "vitest";
import {
  formatShelfDisplayLabel,
  formatShelfProductCountLabel,
  shelfTitleScaleForLabel,
} from "./posShelfDisplayLabel";

describe("formatShelfDisplayLabel", () => {
  it("title-cases single lowercase words", () => {
    expect(formatShelfDisplayLabel("bakery")).toBe("Bakery");
    expect(formatShelfDisplayLabel("rice")).toBe("Rice");
  });

  it("title-cases multi-word lowercase labels", () => {
    expect(formatShelfDisplayLabel("surface go")).toBe("Surface Go");
    expect(formatShelfDisplayLabel("soft drinks")).toBe("Soft Drinks");
  });

  it("normalizes short ALL-CAPS fragments in multi-word labels", () => {
    expect(formatShelfDisplayLabel("Surface GO")).toBe("Surface Go");
  });

  it("preserves already-cased labels", () => {
    expect(formatShelfDisplayLabel("Soft Drinks")).toBe("Soft Drinks");
  });

  it("preserves short ALL CAPS brand codes", () => {
    expect(formatShelfDisplayLabel("OMO")).toBe("OMO");
  });
});

describe("formatShelfProductCountLabel", () => {
  it("uses singular for one product", () => {
    expect(formatShelfProductCountLabel("en", 1)).toBe("1 Product");
  });

  it("uses plural for other counts", () => {
    expect(formatShelfProductCountLabel("en", 0)).toBe("0 Products");
    expect(formatShelfProductCountLabel("en", 2)).toBe("2 Products");
  });
});

describe("shelfTitleScaleForLabel", () => {
  it("does not shrink enterprise title size (Phase 32.4.2)", () => {
    expect(shelfTitleScaleForLabel("Analgesics and more items", 1.5)).toBe(1.5);
    expect(shelfTitleScaleForLabel("Beer", 1.5)).toBe(1.5);
  });
});
