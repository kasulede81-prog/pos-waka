/**
 * Thermal / receipt printer adapter.
 * Transport only — ESC/POS generation and print queue stay outside this file.
 */
import type { PrinterProfile } from "../../types";
import { buildTestEscPos, EscPosBuilder } from "../../lib/escPosBuilder";
import {
  printClassicSppDiagnostic,
  printEscPosNative,
  type NativeClassicDiagnostic,
} from "../../lib/nativeBluetoothPrinter";
import { printEscPosNativeNetwork, testNativeNetworkPrinter } from "../../lib/nativeNetworkPrinter";
import { printEscPosWebBluetooth } from "../../lib/webBluetoothPrinter";
import { withTimeout } from "../../lib/promiseTimeout";
import {
  getHardwareTransportCapabilities,
  resolveBluetoothMode,
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

/** Hard cap so a dead printer cannot freeze the POS or Hardware Test button. */
export const PRINT_IO_TIMEOUT_MS = 12_000;
export const PRINTER_NO_RESPONSE_ERROR = "Printer did not respond. Check that it is on and in range.";

function environmentToPlatform(environment: HardwareEnvironment): PrinterPlatform {
  if (environment === "android-native" || environment === "android-browser") return "android";
  if (environment === "ios-native" || environment === "ios-safari") return "ios";
  if (environment === "electron") return "electron";
  if (environment === "unknown") return "unknown";
  return "web";
}

async function transferUsb(_bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  return {
    ok: false,
    error: "USB thermal printing is not supported in this browser yet.",
  };
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
  return withTimeout(sendEscPosBytesInner(profile, bytes), PRINT_IO_TIMEOUT_MS, {
    ok: false,
    error: PRINTER_NO_RESPONSE_ERROR,
  });
}

async function sendEscPosBytesInner(
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
    case "native-classic": {
      const deviceId = profile.pairedDeviceKey?.trim();
      if (!deviceId) return { ok: false, error: "Select a Bluetooth printer in Hardware settings." };
      return printEscPosNative(deviceId, bytes, "classic");
    }
    case "native-ble": {
      const deviceId = profile.pairedDeviceKey?.trim();
      if (!deviceId) return { ok: false, error: "Select a Bluetooth printer in Hardware settings." };
      return printEscPosNative(deviceId, bytes, "ble");
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

export async function testPrintProfile(
  profile: PrinterProfile,
  lines: string[],
): Promise<{ ok: boolean; error?: string; diagnostic?: NativeClassicDiagnostic }> {
  if (profile.connectionType === "bluetooth" && resolveBluetoothMode(profile) === "classic") {
    const deviceId = profile.pairedDeviceKey?.trim();
    if (!deviceId) return { ok: false, error: "Select a Bluetooth printer in Hardware settings." };
    const caps = await detectPrinterCapabilities();
    const selected = selectPrinterTransport(profile, caps.transports);
    if (!selected.ok) return { ok: false, error: selected.error };
    if (selected.transport !== "native-classic") {
      return { ok: false, error: "Classic printer must use Android RFCOMM/SPP. It was not routed to native-classic." };
    }
    const diagnostic = await printClassicSppDiagnostic(deviceId);
    return {
      ok: diagnostic.ok,
      error: diagnostic.ok ? undefined : diagnostic.error,
      diagnostic,
    };
  }
  const bytes = buildTestEscPos(profile.paperWidth, lines);
  const result = await sendEscPosBytes(profile, bytes);
  if (result.ok) {
    return { ok: true };
  }
  return result;
}
