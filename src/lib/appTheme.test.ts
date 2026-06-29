import { describe, expect, it } from "vitest";
import { applyAppThemeClass, resolveAppTheme } from "./appTheme";

describe("appTheme", () => {
  it("resolves explicit preferences", () => {
    expect(resolveAppTheme("light")).toBe("light");
    expect(resolveAppTheme("dark")).toBe("dark");
  });

  it("applies dark class on document root", () => {
    applyAppThemeClass("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("marketing-theme-dark")).toBe(true);
    applyAppThemeClass("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
