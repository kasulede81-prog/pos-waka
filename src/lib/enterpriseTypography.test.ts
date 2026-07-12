import { describe, expect, it } from "vitest";
import { enterpriseType, enterpriseTypeClass, PROHIBITED_FRACTIONAL_TYPE } from "./enterpriseTypography";

describe("enterpriseTypography", () => {
  it("defines six semantic roles", () => {
    expect(Object.keys(enterpriseType)).toEqual([
      "display",
      "pageTitle",
      "sectionTitle",
      "body",
      "caption",
      "monoNumber",
    ]);
  });

  it("monoNumber uses tabular-nums", () => {
    expect(enterpriseType.monoNumber).toContain("tabular-nums");
  });

  it("enterpriseTypeClass merges extra classes", () => {
    expect(enterpriseTypeClass("body", "mt-2")).toContain("font-medium");
    expect(enterpriseTypeClass("body", "mt-2")).toContain("mt-2");
  });

  it("documents prohibited fractional sizes for lint script", () => {
    expect(PROHIBITED_FRACTIONAL_TYPE.length).toBeGreaterThan(0);
  });
});
