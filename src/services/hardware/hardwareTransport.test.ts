import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrinterProfile } from "../../types";
import {
  CLASSIC_IN_BROWSER_ERROR,
  IOS_BLUETOOTH_ERROR,
  NETWORK_NEEDS_BRIDGE_ERROR,
  canDeliverEscPosWithoutChooser,
  defaultPrinterConnectionType,
  addPrinterConnectionTypes,
  detectHardwareEnvironment,
  getHardwareTransportCapabilities,
  selectPrinterTransport,
  summarizeCapabilityState,
  type HardwareTransportCapabilities,
  type TransportSlot,
} from "./hardwareTransport";

function slot(supported: boolean, available: boolean, reason = "", transportReady = false): TransportSlot {
  return { supported, available, transportReady, reason };
}

function caps(patch: Partial<HardwareTransportCapabilities> = {}): HardwareTransportCapabilities {
  const unavailable = slot(false, false, "no");
  return {
    environment: "desktop-browser",
    bluetooth: {
      classic: unavailable,
      ble: unavailable,
      native: false,
      webBluetooth: false,
    },
    usb: { native: unavailable, webUsb: unavailable },
    network: {
      electron: unavailable,
      androidNative: unavailable,
      browserDirect: slot(false, false, NETWORK_NEEDS_BRIDGE_ERROR),
    },
    ...patch,
  };
}

const profile = (patch: Partial<PrinterProfile> = {}): PrinterProfile => ({
  id: "p1",
  name: "Printer",
  connectionType: "bluetooth",
  paperWidth: "58mm",
  stationRoles: ["receipt"],
  isEnabled: true,
  ...patch,
});

describe("detectHardwareEnvironment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects iOS Safari from the user agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    vi.stubGlobal("window", { navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } });
    expect(detectHardwareEnvironment()).toBe("ios-safari");
  });

  it("detects Android Chrome from the user agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile" });
    vi.stubGlobal("window", {
      navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile" },
    });
    expect(detectHardwareEnvironment()).toBe("android-browser");
  });

  it("detects desktop browser on Windows/macOS Chrome", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" });
    vi.stubGlobal("window", {
      navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" },
    });
    expect(detectHardwareEnvironment()).toBe("desktop-browser");
  });
});

describe("selectPrinterTransport", () => {
  it("routes Android + Classic profile to native Classic", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
      caps({
        environment: "android-native",
        bluetooth: {
          classic: slot(true, true),
          ble: slot(true, true),
          native: true,
          webBluetooth: false,
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "native-classic" });
  });

  it("never routes a Classic profile through Web Bluetooth", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
      caps({
        environment: "android-native",
        bluetooth: {
          classic: slot(true, true, "ready", true),
          ble: slot(true, true, "ready", true),
          native: true,
          webBluetooth: true,
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "native-classic" });
  });

  it("routes Android + BLE profile to native BLE", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "ble:11:22:33:44:55:66", bluetoothTransport: "ble" }),
      caps({
        environment: "android-native",
        bluetooth: {
          classic: slot(true, true),
          ble: slot(true, true),
          native: true,
          webBluetooth: false,
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "native-ble" });
  });

  it("routes Chrome + BLE profile to Web Bluetooth", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "ble:web-id", bluetoothTransport: "ble" }),
      caps({
        environment: "desktop-browser",
        bluetooth: {
          classic: slot(false, false, CLASSIC_IN_BROWSER_ERROR),
          ble: slot(true, true),
          native: false,
          webBluetooth: true,
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "web-bluetooth" });
  });

  it("rejects Chrome + Classic profile with the browser limitation", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
      caps({ environment: "desktop-browser" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("classic_browser_unsupported");
      expect(result.error).toBe(CLASSIC_IN_BROWSER_ERROR);
    }
  });

  it("rejects iOS Safari + Classic profile clearly", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
      caps({ environment: "ios-safari" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ios_bluetooth_unsupported");
      expect(result.error).toBe(IOS_BLUETOOTH_ERROR);
    }
  });

  it("routes Electron + network to the existing LAN bridge", () => {
    const result = selectPrinterTransport(
      profile({
        connectionType: "network",
        networkHost: "192.168.1.50",
        networkPort: 9100,
      }),
      caps({
        environment: "electron",
        network: {
          electron: slot(true, true),
          androidNative: slot(false, false),
          browserDirect: slot(false, false, NETWORK_NEEDS_BRIDGE_ERROR),
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "electron-network" });
  });

  it("routes Android native + network to Android TCP", () => {
    const result = selectPrinterTransport(
      profile({
        connectionType: "network",
        networkHost: "192.168.1.50",
        networkPort: 9100,
      }),
      caps({
        environment: "android-native",
        network: {
          electron: slot(false, false),
          androidNative: slot(true, true),
          browserDirect: slot(false, false, NETWORK_NEEDS_BRIDGE_ERROR),
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "android-network" });
  });

  it("does not claim browser TCP to port 9100", () => {
    const result = selectPrinterTransport(
      profile({
        connectionType: "network",
        networkHost: "192.168.1.50",
        networkPort: 9100,
      }),
      caps({ environment: "desktop-browser" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(NETWORK_NEEDS_BRIDGE_ERROR);
  });

  it("fails clearly when a Bluetooth profile has no saved device", () => {
    const result = selectPrinterTransport(profile({ pairedDeviceKey: null }), caps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_device");
  });
});

describe("API present vs printer transport ready", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not treat Web Bluetooth API presence as a ready printer transport", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
      bluetooth: {},
      usb: {},
    });
    vi.stubGlobal("window", {
      navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0" },
    });
    const caps = await getHardwareTransportCapabilities();
    expect(caps.environment).toBe("desktop-browser");
    expect(caps.bluetooth.ble.available).toBe(true);
    expect(caps.bluetooth.ble.transportReady).toBe(false);
    expect(caps.bluetooth.classic.available).toBe(false);
    expect(caps.bluetooth.classic.transportReady).toBe(false);
    expect(caps.usb.webUsb.available).toBe(true);
    expect(caps.usb.webUsb.transportReady).toBe(false);
    expect(caps.usb.webUsb.supported).toBe(false);
    expect(caps.network.electron.transportReady).toBe(false);
    expect(caps.network.androidNative.transportReady).toBe(false);
    expect(caps.network.browserDirect.available).toBe(false);
  });

  it("does not treat Web Bluetooth API presence as a ready ESC/POS path", () => {
    const summary = summarizeCapabilityState(
      caps({
        bluetooth: {
          classic: slot(false, false, CLASSIC_IN_BROWSER_ERROR),
          ble: slot(true, true, "Web Bluetooth API is present", false),
          native: false,
          webBluetooth: true,
        },
      }),
    );
    expect(summary.state).toBe("PARTIAL");
    expect(summary.bluetoothAvailable).toBe(false);
    expect(summary.escPosAvailable).toBe(false);
  });

  it("does not enqueue-ready Classic or Web BLE in a desktop browser", () => {
    const browser = caps({
      environment: "desktop-browser",
      bluetooth: {
        classic: slot(false, false, CLASSIC_IN_BROWSER_ERROR),
        ble: slot(true, true, "api", false),
        native: false,
        webBluetooth: true,
      },
    });
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
        browser,
      ),
    ).toBe(false);
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "ble:web-id", bluetoothTransport: "ble" }),
        browser,
      ),
    ).toBe(false);
  });

  it("allows Android native Classic without a browser chooser", () => {
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
        caps({
          environment: "android-native",
          bluetooth: {
            classic: slot(true, true, "ready", true),
            ble: slot(true, true, "ready", true),
            native: true,
            webBluetooth: false,
          },
        }),
      ),
    ).toBe(true);
  });

  it("keeps Android native Classic as a ready printer transport", () => {
    const result = selectPrinterTransport(
      profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
      caps({
        environment: "android-native",
        bluetooth: {
          classic: slot(true, true, "ready", true),
          ble: slot(true, true, "ready", true),
          native: true,
          webBluetooth: false,
        },
      }),
    );
    expect(result).toEqual({ ok: true, transport: "native-classic" });
  });
});

describe("connection defaults and USB honesty", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("defaults Android to Bluetooth and never to USB", () => {
    const android = caps({
      environment: "android-native",
      bluetooth: {
        classic: slot(true, true, "ready", true),
        ble: slot(true, true, "ready", true),
        native: true,
        webBluetooth: false,
      },
    });
    expect(defaultPrinterConnectionType(android)).toBe("bluetooth");
    expect(addPrinterConnectionTypes(android)).toEqual(["bluetooth", "network"]);
  });

  it("defaults Electron to network", () => {
    const electron = caps({
      environment: "electron",
      network: {
        electron: slot(true, true, "ready", true),
        androidNative: slot(false, false),
        browserDirect: slot(false, false, NETWORK_NEEDS_BRIDGE_ERROR),
      },
    });
    expect(defaultPrinterConnectionType(electron)).toBe("network");
    expect(addPrinterConnectionTypes(electron)).toEqual(["network", "bluetooth"]);
  });

  it("does not treat USB API presence as a ready printer transport", () => {
    const usbCaps = caps({
      usb: {
        native: slot(false, false),
        webUsb: slot(false, true, "USB thermal printing is not supported in this browser yet.", false),
      },
    });
    expect(usbCaps.usb.webUsb.available).toBe(true);
    expect(usbCaps.usb.webUsb.transportReady).toBe(false);
    expect(
      selectPrinterTransport(profile({ connectionType: "usb" }), usbCaps).ok,
    ).toBe(false);
  });

  it("does not enable Web Bluetooth on Electron", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Electron/28.0.0 Chrome/120.0.0.0",
      bluetooth: {},
      usb: {},
    });
    vi.stubGlobal("window", {
      wakaDesktop: { hardware: { printer: { printEscPos: async () => ({ ok: true }) } } },
      navigator: { userAgent: "Mozilla/5.0 Electron/28.0.0 Chrome/120.0.0.0" },
    });
    const resolved = await getHardwareTransportCapabilities();
    expect(resolved.environment).toBe("electron");
    expect(resolved.bluetooth.webBluetooth).toBe(false);
  });

  it("defaults Chrome to Bluetooth LE when Web Bluetooth exists", () => {
    const chrome = caps({
      environment: "desktop-browser",
      bluetooth: {
        classic: slot(false, false, CLASSIC_IN_BROWSER_ERROR),
        ble: slot(true, true, "api", false),
        native: false,
        webBluetooth: true,
      },
    });
    expect(defaultPrinterConnectionType(chrome)).toBe("bluetooth");
    expect(addPrinterConnectionTypes(chrome)).toEqual(["bluetooth", "network"]);
  });
});

describe("kitchen and sale delivery rules", () => {
  it("blocks USB, browser Classic, browser TCP, and Web BLE without a session", () => {
    const browser = caps({
      environment: "desktop-browser",
      bluetooth: {
        classic: slot(false, false, CLASSIC_IN_BROWSER_ERROR),
        ble: slot(true, true, "api", false),
        native: false,
        webBluetooth: true,
      },
      usb: {
        native: slot(false, false),
        webUsb: slot(false, true, "USB thermal printing is not supported in this browser yet.", false),
      },
    });
    expect(
      canDeliverEscPosWithoutChooser(profile({ connectionType: "usb" }), browser),
    ).toBe(false);
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
        browser,
      ),
    ).toBe(false);
    expect(
      canDeliverEscPosWithoutChooser(
        profile({
          connectionType: "network",
          networkHost: "192.168.1.50",
          networkPort: 9100,
        }),
        browser,
      ),
    ).toBe(false);
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "ble:web-id", bluetoothTransport: "ble" }),
        browser,
      ),
    ).toBe(false);
  });

  it("allows Android Classic and BLE, and Electron LAN", () => {
    const android = caps({
      environment: "android-native",
      bluetooth: {
        classic: slot(true, true, "ready", true),
        ble: slot(true, true, "ready", true),
        native: true,
        webBluetooth: false,
      },
    });
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF", bluetoothTransport: "classic" }),
        android,
      ),
    ).toBe(true);
    expect(
      canDeliverEscPosWithoutChooser(
        profile({ pairedDeviceKey: "ble:11:22:33:44:55:66", bluetoothTransport: "ble" }),
        android,
      ),
    ).toBe(true);

    const electron = caps({
      environment: "electron",
      network: {
        electron: slot(true, true, "ready", true),
        androidNative: slot(false, false),
        browserDirect: slot(false, false, NETWORK_NEEDS_BRIDGE_ERROR),
      },
    });
    expect(
      canDeliverEscPosWithoutChooser(
        profile({
          connectionType: "network",
          networkHost: "192.168.1.50",
          networkPort: 9100,
        }),
        electron,
      ),
    ).toBe(true);
  });
});

describe("sale and kitchen share the same delivery guard", () => {
  it("both enqueue paths consult canDeliverEscPosWithoutChooser", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const kitchen = readFileSync(join(here, "../../store/hardwarePrintMutations.ts"), "utf8");
    const sale = readFileSync(join(here, "../../lib/retailReceiptPrint.ts"), "utf8");
    expect(kitchen).toContain("canDeliverEscPosWithoutChooser(printer, caps.transports)");
    expect(sale).toContain("canDeliverEscPosWithoutChooser(profile, caps.transports)");
  });
});
