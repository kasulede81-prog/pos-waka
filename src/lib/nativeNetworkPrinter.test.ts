import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => "web",
  },
  registerPlugin: () => ({
    getTransportState: vi.fn(),
    printEscPos: vi.fn(),
    testConnection: vi.fn(),
  }),
}));

describe("nativeNetworkPrinter platform gate", () => {
  it("is unavailable off Android", async () => {
    const { isNativeNetworkPrinterAvailable, isNativeNetworkPrinterPlatform } = await import("./nativeNetworkPrinter");
    expect(isNativeNetworkPrinterPlatform()).toBe(false);
    await expect(isNativeNetworkPrinterAvailable()).resolves.toBe(false);
  });
});
