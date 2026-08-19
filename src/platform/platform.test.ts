import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => false);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    getPlatform: () => (isNativePlatform() ? "android" : "web"),
  },
}));

import {
  canEscPosNetwork,
  canNativePrint,
  canRemoteSupportNative,
  getCapabilities,
  getPlatform,
  hasCapability,
  hasWakaDesktopBridge,
  isDesktopPlatform,
  isMobilePlatform,
  isWebPlatform,
} from "./index";

function clearDesktopBridge() {
  if (typeof window !== "undefined" && "wakaDesktop" in window) {
    delete (window as Window & { wakaDesktop?: unknown }).wakaDesktop;
  }
  const g = globalThis as { wakaDesktop?: unknown };
  if ("wakaDesktop" in g) delete g.wakaDesktop;
}

function installDesktopBridge(partial: NonNullable<Window["wakaDesktop"]>) {
  if (typeof window !== "undefined") {
    window.wakaDesktop = partial;
  }
  (globalThis as { wakaDesktop?: Window["wakaDesktop"] }).wakaDesktop = partial;
}

function stubBrowserGlobals(userAgent = "Mozilla/5.0") {
  const nav = { userAgent, mediaDevices: undefined as MediaDevices | undefined };
  const win = {
    navigator: nav,
    wakaDesktop: undefined as Window["wakaDesktop"] | undefined,
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
}

describe("platform detect", () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    stubBrowserGlobals("Mozilla/5.0");
    clearDesktopBridge();
  });

  afterEach(() => {
    clearDesktopBridge();
    vi.unstubAllGlobals();
  });

  it("resolves web in a normal browser", () => {
    expect(getPlatform()).toBe("web");
    expect(isWebPlatform()).toBe(true);
    expect(isMobilePlatform()).toBe(false);
    expect(isDesktopPlatform()).toBe(false);
  });

  it("resolves mobile when Capacitor is native", () => {
    isNativePlatform.mockReturnValue(true);
    expect(getPlatform()).toBe("mobile");
    expect(isMobilePlatform()).toBe(true);
    expect(isDesktopPlatform()).toBe(false);
  });

  it("resolves desktop from the preload bridge without userAgent Electron", () => {
    installDesktopBridge({ platform: "win32", print: async () => ({ ok: true }) });
    expect(hasWakaDesktopBridge()).toBe(true);
    expect(getPlatform()).toBe("desktop");
    expect(isDesktopPlatform()).toBe(true);
  });

  it("resolves desktop from Electron userAgent when bridge is absent", () => {
    stubBrowserGlobals("Mozilla/5.0 Electron/37.0.0");
    clearDesktopBridge();
    expect(getPlatform()).toBe("desktop");
  });

  it("prefers mobile over desktop if both signals were somehow present", () => {
    isNativePlatform.mockReturnValue(true);
    installDesktopBridge({ platform: "win32" });
    expect(getPlatform()).toBe("mobile");
  });
});

describe("capabilities", () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    stubBrowserGlobals("Mozilla/5.0");
    clearDesktopBridge();
  });

  afterEach(() => {
    clearDesktopBridge();
    vi.unstubAllGlobals();
  });

  it("web: offline + scanners; no native print / RS / LAN ESC/POS", () => {
    const caps = getCapabilities();
    expect(getPlatform()).toBe("web");
    expect(caps).toMatchObject({
      nativePrinting: false,
      escPosNetwork: false,
      cashDrawer: false,
      barcodeScannerHid: true,
      barcodeScannerCamera: true,
      desktopDiagnostics: false,
      offlinePOS: true,
      remoteSupportNative: false,
    });
  });

  it("mobile: camera path; no Electron native printing or RS", () => {
    isNativePlatform.mockReturnValue(true);
    stubBrowserGlobals("Mozilla/5.0");
    const caps = getCapabilities();
    expect(getPlatform()).toBe("mobile");
    expect(caps.nativePrinting).toBe(false);
    expect(caps.escPosNetwork).toBe(false);
    expect(caps.cashDrawer).toBe(false);
    expect(caps.barcodeScannerHid).toBe(false);
    expect(caps.desktopDiagnostics).toBe(false);
    expect(caps.offlinePOS).toBe(true);
    expect(caps.remoteSupportNative).toBe(false);
  });

  it("desktop without preload APIs does not invent hardware capabilities", () => {
    stubBrowserGlobals("Mozilla/5.0 Electron/37.0.0");
    clearDesktopBridge();
    const caps = getCapabilities();
    expect(getPlatform()).toBe("desktop");
    expect(caps.nativePrinting).toBe(false);
    expect(caps.escPosNetwork).toBe(false);
    expect(caps.cashDrawer).toBe(false);
    expect(caps.desktopDiagnostics).toBe(false);
    expect(caps.remoteSupportNative).toBe(false);
    expect(caps.offlinePOS).toBe(true);
    expect(caps.barcodeScannerHid).toBe(true);
  });

  it("desktop reports only APIs that the preload bridge actually exposes", () => {
    installDesktopBridge({
      platform: "win32",
      print: async () => ({ ok: true }),
      getPrinterDiagnostics: async () => ({}),
      remoteSupport: {
        getStatus: async () => ({ ok: true, status: "idle" }),
        endSession: async () => ({ ok: true, status: "stopped" }),
        requestAuthorizationCheck: async () => ({ ok: true, status: "idle" }),
        startAuthorizedTransport: async () => ({ ok: true, status: "idle" }),
        stopTransport: async () => ({ ok: true, status: "stopped" }),
        getTransportStatus: async () => ({ ok: true, status: "idle" }),
      },
    });
    const caps = getCapabilities();
    expect(caps.nativePrinting).toBe(true);
    expect(caps.desktopDiagnostics).toBe(true);
    expect(caps.remoteSupportNative).toBe(true);
    expect(caps.escPosNetwork).toBe(false);
    expect(caps.cashDrawer).toBe(false);
    expect(canNativePrint()).toBe(true);
    expect(canRemoteSupportNative()).toBe(true);
    expect(canEscPosNetwork()).toBe(false);
    expect(hasCapability("offlinePOS")).toBe(true);
  });

  it("escPosNetwork stays false until the bridge implements it", () => {
    installDesktopBridge({
      platform: "win32",
      print: async () => ({ ok: true }),
      escPosNetwork: async () => ({ ok: true }),
    });
    expect(getCapabilities().escPosNetwork).toBe(true);
    expect(canEscPosNetwork()).toBe(true);
  });

  it("escPosNetwork is true when hardware.printer.printEscPos exists", () => {
    installDesktopBridge({
      platform: "win32",
      hardware: {
        printer: {
          printEscPos: async () => ({ ok: true }),
          testConnection: async () => ({ ok: true, message: "Printer connected" }),
          getStatus: async () => ({ ok: true, status: "reachable" }),
        },
      },
    });
    expect(getCapabilities().escPosNetwork).toBe(true);
    expect(canEscPosNetwork()).toBe(true);
    expect(getCapabilities().cashDrawer).toBe(false);
  });
});
