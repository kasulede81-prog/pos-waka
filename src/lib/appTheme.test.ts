import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppThemeClass, resolveAppTheme } from "./appTheme";

describe("appTheme", () => {
  const classes = new Set<string>();

  beforeEach(() => {
    classes.clear();
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          add: (name: string) => {
            classes.add(name);
          },
          remove: (name: string) => {
            classes.delete(name);
          },
          toggle: (name: string, on?: boolean) => {
            if (on === undefined) {
              if (classes.has(name)) classes.delete(name);
              else classes.add(name);
              return;
            }
            if (on) classes.add(name);
            else classes.delete(name);
          },
          contains: (name: string) => classes.has(name),
        },
        style: {} as CSSStyleDeclaration,
      },
      querySelector: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
