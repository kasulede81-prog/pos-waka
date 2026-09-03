/**
 * Thermal / receipt printer adapter.
 * Transport only — ESC/POS generation and print queue stay outside this file.
 */
import type { PrinterProfile } from "../../types";
import { buildTestEscPos, EscPosBuilder } from "../../lib/escPosBuilder";
import { printEscPosNative } from "../../lib/nativeBluetoothPrinter";
import { printEscPosNativeNetwork, testNativeNetworkPrinter } from "../../lib/nativeNetworkPrinter";
import { printEscPosWebBluetooth } from "../../lib/webBluetoothPrinter";
import {
  getHardwareTransportCapabilities,
  selectPrinterTransport,
  summarizeCapabilityState,
  type HardwareEnvironment,
  type HardwareTransportCapabilities,
} from "./hardwareTransport";

export type PrinterPaperWidth = "58mm" | "80mm";

export type PrinterPlatform = "web" | "android" | "ios" | "electron" | "unknown";

/** Production certification state — do not claim "ready" unless SUPPORTED. */
export type PrinterCapabilityState = "SUPPORTED" | "PARTIAL" | "UNAVAILABLE";

export type PrinterCapabilities = {
  bluetoothAvailable: boolean;
  usbAvailable: boolean;
  networkAvailable: boolean;
  sunmiBuiltIn: boolean;
  escPosAvailable: boolean;
  platform: PrinterPlatform;
  state: PrinterCapabilityState;
  stateReason: string;
  nativeBluetoothPrinter: boolean;
  classicSppSupported: boolean;
  bleSupported: boolean;
  environment: HardwareEnvironment;
  transports: HardwareTransportCapabilities;
};

function environmentToPlatform(environment: HardwareEnvironment): PrinterPlatform {
  if (environment === "android-native" || environment === "android-browser") return "android";
  if (environment === "ios-native" || environment === "ios-safari") return "ios";
  if (environment === "electron") return "electron";
  if (environment === "unknown") return "unknown";
  return "web";
}

async function transferUsb(bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  if (typeof navigator === "undefined" || !("usb" in navigator)) {
    return { ok: false, error: "USB printing is not available in this browser." };
  }
  try {
    const usb = navigator.usb as {
      requestDevice: (opts: { filters: Array<Record<string, unknown>> }) => Promise<{
        configuration: unknown;
        open: () => Promise<void>;
        selectConfiguration: (cfg: number) => Promise<void>;
        claimInterface: (idx: number) => Promise<void>;
        transferOut: (endpoint: number, data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
      }>;
    };
    const device = await usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration == null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    await device.transferOut(1, bytes);
    await device.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "USB thermal print failed." };
  }
}

async function transferNetwork(
  profile: PrinterProfile,
  bytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  const host = profile.networkHost?.trim();
  const port = profile.networkPort ?? 9100;
  if (!host) return { ok: false, error: "Network printer host not set." };

  const payload = {
    host,
    port,
    data: Array.from(bytes),
  };

  const printerApi = typeof window !== "undefined" ? window.wakaDesktop?.hardware?.printer : undefined;
  if (printerApi && typeof printerApi.printEscPos === "function") {
    try {
      const result = await printerApi.printEscPos(payload);
      return result.ok
        ? { ok: true }
        : { ok: false, error: result.error ?? result.message ?? "Could not connect to printer" };
    } catch {
      return { ok: false, error: "Could not connect to printer" };
    }
  }

  if (typeof window !== "undefined" && typeof window.wakaDesktop?.escPosNetwork === "function") {
    try {
      const result = await window.wakaDesktop.escPosNetwork(payload);
      return result.ok
        ? { ok: true }
        : { ok: false, error: result.error ?? "Could not connect to printer" };
    } catch {
      return { ok: false, error: "Could not connect to printer" };
    }
  }

  return printEscPosNativeNetwork(host, port, bytes);
}

/** Probe TCP reachability via the desktop or Android bridge (no sale/checkout side effects). */
export async function testNetworkPrinterConnection(
  profile: Pick<PrinterProfile, "networkHost" | "networkPort">,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const host = profile.networkHost?.trim();
  const port = profile.networkPort ?? 9100;
  if (!host) return { ok: false, error: "Network printer host not set." };

  const printerApi = typeof window !== "undefined" ? window.wakaDesktop?.hardware?.printer : undefined;
  if (printerApi && typeof printerApi.testConnection === "function") {
    try {
      const result = await printerApi.testConnection({ host, port });
      if (result.ok) {
        return { ok: true, message: result.message ?? "Printer connected" };
      }
      return { ok: false, error: result.error ?? "Could not connect to printer" };
    } catch {
      return { ok: false, error: "Could not connect to printer" };
    }
  }

  return testNativeNetworkPrinter(host, port);
}

export async function detectPrinterCapabilities(): Promise<PrinterCapabilities> {
  const transports = await getHardwareTransportCapabilities();
  const summary = summarizeCapabilityState(transports);
  return {
    bluetoothAvailable: summary.bluetoothAvailable,
    usbAvailable: summary.usbAvailable,
    networkAvailable: summary.networkAvailable,
    sunmiBuiltIn: false,
    escPosAvailable: summary.escPosAvailable,
    platform: environmentToPlatform(transports.environment),
    state: summary.state,
    stateReason: summary.stateReason,
    nativeBluetoothPrinter: summary.nativeBluetoothPrinter,
    classicSppSupported: summary.classicSppSupported,
    bleSupported: summary.bleSupported,
    environment: transports.environment,
    transports,
  };
}

export async function sendEscPosBytes(
  profile: PrinterProfile,
  bytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  const caps = await detectPrinterCapabilities();
  const selected = selectPrinterTransport(profile, caps.transports);
  if (!selected.ok) {
    return { ok: false, error: selected.error };
  }
  switch (selected.transport) {
    case "electron-network":
    case "android-network":
      return transferNetwork(profile, bytes);
    case "native-classic":
    case "native-ble": {
      const deviceId = profile.pairedDeviceKey?.trim();
      if (!deviceId) return { ok: false, error: "Select a Bluetooth printer in Hardware settings." };
      return printEscPosNative(deviceId, bytes, selected.transport === "native-ble" ? "ble" : "classic");
    }
    case "web-bluetooth":
      return printEscPosWebBluetooth(bytes, profile.pairedDeviceKey);
    case "web-usb":
      return transferUsb(bytes);
    default:
      return { ok: false, error: caps.stateReason };
  }
}

export async function kickCashDrawer(profile: PrinterProfile): Promise<{ ok: boolean; error?: string }> {
  const bytes = new EscPosBuilder(profile.paperWidth).kickDrawer().build();
  return sendEscPosBytes(profile, bytes);
}

export async function testPrint(_payload: { width: PrinterPaperWidth; lines: string[] }): Promise<{ ok: boolean; error?: string }> {
  const caps = await detectPrinterCapabilities();
  if (caps.nativeBluetoothPrinter || caps.transports.bluetooth.webBluetooth) {
    return { ok: false, error: "Select a Bluetooth printer in Hardware settings." };
  }
  if (!caps.escPosAvailable) {
    return { ok: false, error: caps.stateReason };
  }
  const bytes = buildTestEscPos(_payload.width, _payload.lines);
  if (caps.usbAvailable) {
    const usb = await transferUsb(bytes);
    if (usb.ok) return usb;
  }
  return { ok: false, error: caps.stateReason };
}

export async function testPrintProfile(profile: PrinterProfile, lines: string[]): Promise<{ ok: boolean; error?: string }> {
  const bytes = buildTestEscPos(profile.paperWidth, lines);
  const result = await sendEscPosBytes(profile, bytes);
  if (result.ok) {
    return { ok: true };
  }
  return result;
}
