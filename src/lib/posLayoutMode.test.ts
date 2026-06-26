import { describe, expect, it } from "vitest";
import { resolvePosLayoutMode } from "./posLayoutMode";

describe("resolvePosLayoutMode", () => {
  it("mobile below 768px", () => {
    expect(resolvePosLayoutMode(320)).toBe("mobile");
    expect(resolvePosLayoutMode(767)).toBe("mobile");
  });

  it("compact desktop 768–1023px", () => {
    expect(resolvePosLayoutMode(768)).toBe("compact");
    expect(resolvePosLayoutMode(1023)).toBe("compact");
  });

  it("full desktop from 1024px", () => {
    expect(resolvePosLayoutMode(1024)).toBe("full");
    expect(resolvePosLayoutMode(1280)).toBe("full");
    expect(resolvePosLayoutMode(1920)).toBe("full");
  });
});
