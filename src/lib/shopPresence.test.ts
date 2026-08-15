import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isNative = vi.fn(() => false);
const getPlatform = vi.fn(() => "web");
const isElectron = vi.fn(() => false);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNative(),
    getPlatform: () => getPlatform(),
  },
}));

vi.mock("./electronDesktop", () => ({
  isElectronDesktop: () => isElectron(),
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => true,
}));

vi.mock("./supabase", () => ({
  supabase: null,
}));

import { presenceLabel, presencePlatform } from "./shopPresence";

describe("presencePlatform", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    isNative.mockReturnValue(false);
    getPlatform.mockReturnValue("web");
    isElectron.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports windows + Windows POS for Electron desktop", () => {
    isElectron.mockReturnValue(true);
    expect(presencePlatform()).toBe("windows");
    expect(presenceLabel()).toBe("Windows POS");
  });

  it("keeps browser sessions as web", () => {
    expect(presencePlatform()).toBe("web");
    expect(presenceLabel()).toBe("Web POS");
  });

  it("keeps Capacitor android as android", () => {
    isNative.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    expect(presencePlatform()).toBe("android");
    expect(presenceLabel()).toBe("Android POS");
  });
});
