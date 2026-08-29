import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const isNativePlatform = vi.fn(() => false);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    getPlatform: () => (isNativePlatform() ? "android" : "web"),
  },
}));

import {
  DESKTOP_DENSITY_CLASS,
  DESKTOP_TABLE_ROW_H,
  MOBILE_TABLE_ROW_H,
  resolveEnterpriseTableRowHeight,
  shouldApplyDesktopDensity,
  syncDesktopDensityClass,
} from "./desktopDensity";

function clearDesktopBridge() {
  if (typeof window !== "undefined" && "wakaDesktop" in window) {
    delete (window as Window & { wakaDesktop?: unknown }).wakaDesktop;
  }
  const g = globalThis as { wakaDesktop?: unknown };
  if ("wakaDesktop" in g) delete g.wakaDesktop;
}

function installDesktopBridge() {
  const bridge = { platform: "win32" };
  if (typeof window !== "undefined") {
    (window as Window & { wakaDesktop?: unknown }).wakaDesktop = bridge;
  }
  (globalThis as { wakaDesktop?: unknown }).wakaDesktop = bridge;
}

const htmlClasses = new Set<string>();

function stubRuntime(opts: { innerWidth: number; userAgent?: string; native?: boolean }) {
  isNativePlatform.mockReturnValue(Boolean(opts.native));
  htmlClasses.clear();
  const nav = { userAgent: opts.userAgent ?? "Mozilla/5.0" };
  const win = {
    innerWidth: opts.innerWidth,
    navigator: nav,
    wakaDesktop: undefined as unknown,
    matchMedia: (query: string) => ({
      matches: opts.innerWidth >= 1024 && query.includes("1024"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("document", {
    documentElement: {
      classList: {
        toggle: (name: string, on?: boolean) => {
          if (on) htmlClasses.add(name);
          else htmlClasses.delete(name);
        },
        contains: (name: string) => htmlClasses.has(name),
        add: (name: string) => htmlClasses.add(name),
        remove: (name: string) => htmlClasses.delete(name),
      },
    },
  });
}

describe("shouldApplyDesktopDensity", () => {
  it("web phone and tablet stay off", () => {
    expect(shouldApplyDesktopDensity({ platform: "web", viewportWidth: 390 })).toBe(false);
    expect(shouldApplyDesktopDensity({ platform: "web", viewportWidth: 768 })).toBe(false);
    expect(shouldApplyDesktopDensity({ platform: "web", viewportWidth: 1023 })).toBe(false);
  });

  it("web desktop turns on at 1024 and stays on", () => {
    expect(shouldApplyDesktopDensity({ platform: "web", viewportWidth: 1024 })).toBe(true);
    expect(shouldApplyDesktopDensity({ platform: "web", viewportWidth: 1280 })).toBe(true);
    expect(shouldApplyDesktopDensity({ platform: "web", viewportWidth: 1920 })).toBe(true);
  });

  it("Electron is on at any viewport", () => {
    expect(shouldApplyDesktopDensity({ platform: "desktop", viewportWidth: 390 })).toBe(true);
    expect(shouldApplyDesktopDensity({ platform: "desktop", viewportWidth: 1024 })).toBe(true);
    expect(shouldApplyDesktopDensity({ platform: "desktop", viewportWidth: 1280 })).toBe(true);
    expect(shouldApplyDesktopDensity({ platform: "desktop", viewportWidth: 1920 })).toBe(true);
  });

  it("Capacitor / native never enables, even at large CSS widths", () => {
    for (const width of [390, 768, 1024, 1280, 1920]) {
      expect(shouldApplyDesktopDensity({ platform: "mobile", viewportWidth: width })).toBe(false);
    }
  });
});

describe("resolveEnterpriseTableRowHeight", () => {
  it("keeps the compact default when density is off", () => {
    expect(resolveEnterpriseTableRowHeight(undefined, false)).toBe(MOBILE_TABLE_ROW_H);
    expect(resolveEnterpriseTableRowHeight(44, false)).toBe(44);
    expect(resolveEnterpriseTableRowHeight(52, false)).toBe(52);
  });

  it("uses the desktop default only when the caller asked for compact 44", () => {
    expect(resolveEnterpriseTableRowHeight(undefined, true)).toBe(DESKTOP_TABLE_ROW_H);
    expect(resolveEnterpriseTableRowHeight(44, true)).toBe(DESKTOP_TABLE_ROW_H);
    expect(resolveEnterpriseTableRowHeight(52, true)).toBe(52);
    expect(resolveEnterpriseTableRowHeight(56, true)).toBe(56);
  });
});

describe("syncDesktopDensityClass", () => {
  afterEach(() => {
    clearDesktopBridge();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    clearDesktopBridge();
  });

  it("does not set the class on web phone", () => {
    stubRuntime({ innerWidth: 390 });
    expect(syncDesktopDensityClass()).toBe(false);
    expect(htmlClasses.has(DESKTOP_DENSITY_CLASS)).toBe(false);
  });

  it("sets the class on web desktop", () => {
    stubRuntime({ innerWidth: 1280 });
    expect(syncDesktopDensityClass()).toBe(true);
    expect(htmlClasses.has(DESKTOP_DENSITY_CLASS)).toBe(true);
  });

  it("sets the class on Electron even below 1024", () => {
    stubRuntime({ innerWidth: 800, userAgent: "Mozilla/5.0 Electron/37.0.0" });
    installDesktopBridge();
    expect(syncDesktopDensityClass()).toBe(true);
    expect(htmlClasses.has(DESKTOP_DENSITY_CLASS)).toBe(true);
  });

  it("never sets the class when Capacitor is native at 1280", () => {
    stubRuntime({ innerWidth: 1280, native: true });
    expect(syncDesktopDensityClass()).toBe(false);
    expect(htmlClasses.has(DESKTOP_DENSITY_CLASS)).toBe(false);
  });

  it("isNativeApp true never enables desktop density", () => {
    stubRuntime({ innerWidth: 1920, native: true });
    expect(syncDesktopDensityClass()).toBe(false);
    expect(htmlClasses.has(DESKTOP_DENSITY_CLASS)).toBe(false);
  });
});

describe("desktop density CSS contract", () => {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const table = readFileSync(
    resolve(process.cwd(), "src/components/enterprise/data-table/EnterpriseDataTable.tsx"),
    "utf8",
  );

  it("gates overrides on html.waka-desktop-density rather than a global lg:text-base campaign", () => {
    expect(css).toContain(`html.${DESKTOP_DENSITY_CLASS}`);
    expect(css).toContain("--dd-font-table-header");
    expect(css).toContain("--dd-font-table-cell");
    expect(table).not.toContain("lg:text-base");
    expect(table).toContain("text-[10px]");
    expect(table).toContain("text-xs");
  });
});
