import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => false);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    getPlatform: () => (isNativePlatform() ? "android" : "web"),
  },
}));

import {
  isDesktopPosCatalogUi,
  isDesktopPosTerminal,
  isWebFullDesktopPos,
  useDesktopPosSplitLayout,
} from "./desktopPosTerminal";

function stubBrowserGlobals() {
  const win = { wakaDesktop: undefined as Window["wakaDesktop"] | undefined, navigator: { userAgent: "Mozilla/5.0" } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", win.navigator);
  return win;
}

describe("desktopPosTerminal", () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    stubBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false on web even at full desktop viewport", () => {
    expect(isDesktopPosTerminal()).toBe(false);
    expect(isWebFullDesktopPos(true)).toBe(true);
    expect(isWebFullDesktopPos(false)).toBe(false);
  });

  it("is true only with Electron bridge", () => {
    window.wakaDesktop = { platform: "win32" };
    expect(isDesktopPosTerminal()).toBe(true);
    expect(isWebFullDesktopPos(true)).toBe(false);
    expect(useDesktopPosSplitLayout(false)).toBe(true);
    expect(isDesktopPosCatalogUi(false)).toBe(true);
  });
});
