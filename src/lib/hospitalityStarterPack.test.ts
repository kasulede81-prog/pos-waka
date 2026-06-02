import { describe, expect, it } from "vitest";
import { starterPackForBusinessType } from "../data/starterPacks";
import { t } from "./i18n";

describe("hospitality starter packs", () => {
  it("uses dedicated restaurant & bar pack (not bar-only)", () => {
    const pack = starterPackForBusinessType("restaurant_bar");
    const names = pack.map((line) => t("en", line.nameKey).toLowerCase());
    expect(names.some((n) => n.includes("pilau"))).toBe(true);
    expect(names.some((n) => n.includes("chapati"))).toBe(true);
    expect(names.some((n) => n.includes("chicken"))).toBe(true);
    expect(names.some((n) => n.includes("beer") || n.includes("nile"))).toBe(true);
    expect(names.some((n) => n.includes("juice"))).toBe(true);
  });

  it("bar pack stays drink-focused", () => {
    const pack = starterPackForBusinessType("bar");
    const names = pack.map((line) => t("en", line.nameKey).toLowerCase());
    expect(names.some((n) => n.includes("pilau"))).toBe(false);
    expect(names.some((n) => n.includes("nile") || n.includes("beer"))).toBe(true);
  });
});
