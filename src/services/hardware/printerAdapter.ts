/**
 * Thermal / receipt printer adapter (Bluetooth, USB, network framework).
 * Web APIs + optional Electron bridge for LAN printers.
 */
import type { PrinterProfile } from "../../types";
import { buildTestEscPos, EscPosBuilder } from "../../lib/escPosBuilder";

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
};

const BT_PRINTER_SERVICES = [0xffe0, 0x18f0];
const BT_PRINTER_CHARS = [0xffe1, 0x2af1];

declare global {
  interface Window {
    wakaDesktop?: {
      platform?: string;
      print?: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; error?: string }>;
      escPosNetwork?: (opts: {
        host: string;
        port: number;
        data: number[];
      }) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

function resolvePlatform(): PrinterPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("electron")) return "electron";
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  return "web";
}

function resolveCapabilityState(
  platform: PrinterPlatform,
  bluetoothAvailable: boolean,
  usbAvailable: boolean,
): { state: PrinterCapabilityState; stateReason: string; escPosAvailable: boolean } {
  if (typeof navigator === "undefined") {
    return { state: "UNAVAILABLE", stateReason: "No browser runtime.", escPosAvailable: false };
  }
  if (usbAvailable) {
    return {
      state: "SUPPORTED",
      stateReason: "WebUSB thermal printing available (pair printer, allow access).",
      escPosAvailable: true,
    };
  }
  if (bluetoothAvailable) {
    return {
      state: "PARTIAL",
      stateReason: "Web Bluetooth may work with compatible printers; use browser print as fallback.",
      escPosAvailable: true,
    };
  }
  if (platform === "electron") {
    return {
      state: "PARTIAL",
      stateReason: "Use system print or LAN ESC/POS when configured. USB/BT needs WebUSB/Web Bluetooth.",
      escPosAvailable: true,
    };
  }
  if (platform === "android" || platform === "ios") {
    return {
      state: "PARTIAL",
      stateReason: "Native thermal SDK not installed. Use Receipt Print or save/share PDF.",
      escPosAvailable: false,
    };
  }
  return {
    state: "PARTIAL",
    stateReason: "Browser print to any printer or Save as PDF from the print dialog.",
    escPosAvailable: false,
  };
}

function toEscPos(payload: { width: PrinterPaperWidth; lines: string[] }): Uint8Array {
  return buildTestEscPos(payload.width, payload.lines);
}

async function transferUsb(bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  if (typeof navigator === "undefined" || !("usb" in navigator)) {
    return { ok: false, error: "WebUSB not available." };
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

async function transferBluetooth(bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
    return { ok: false, error: "Web Bluetooth not available." };
  }
  try {
    const bluetooth = navigator.bluetooth as {
      requestDevice: (opts: {
        acceptAllDevices: boolean;
        optionalServices: number[];
      }) => Promise<{
        gatt?: {
          connect: () => Promise<{
            getPrimaryService: (service: number) => Promise<{
              getCharacteristic: (char: number) => Promise<{ writeValue: (data: Uint8Array) => Promise<void> }>;
            }>;
          }>;
          disconnect: () => void;
        };
      }>;
    };
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BT_PRINTER_SERVICES,
    });
    const server = await device.gatt?.connect();
    if (!server) return { ok: false, error: "Bluetooth printer connection failed." };
    const service = await server.getPrimaryService(BT_PRINTER_SERVICES[0]);
    const characteristic = await service.getCharacteristic(BT_PRINTER_CHARS[0]);
    await characteristic.writeValue(bytes);
    device.gatt?.disconnect();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bluetooth thermal print failed." };
  }
}

async function transferNetwork(
  profile: PrinterProfile,
  bytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  const host = profile.networkHost?.trim();
  const port = profile.networkPort ?? 9100;
  if (!host) return { ok: false, error: "Network printer host not set." };
  if (typeof window !== "undefined" && window.wakaDesktop?.escPosNetwork) {
    try {
      const result = await window.wakaDesktop.escPosNetwork({
        host,
        port,
        data: Array.from(bytes),
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Network print failed." };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Network print failed." };
    }
  }
  return {
    ok: false,
    error: "LAN ESC/POS needs the Waka desktop app or a print server bridge.",
  };
}

export async function detectPrinterCapabilities(): Promise<PrinterCapabilities> {
  const hasNavigator = typeof navigator !== "undefined";
  const bluetoothAvailable = hasNavigator && "bluetooth" in navigator;
  const usbAvailable = hasNavigator && "usb" in navigator;
  const platform = resolvePlatform();
  const networkAvailable = platform === "electron" || Boolean(typeof window !== "undefined" && window.wakaDesktop?.escPosNetwork);
  const sunmiBuiltIn = false;
  const { state, stateReason, escPosAvailable } = resolveCapabilityState(platform, bluetoothAvailable, usbAvailable);
  return {
    bluetoothAvailable,
    usbAvailable,
    networkAvailable,
    sunmiBuiltIn,
    escPosAvailable: escPosAvailable || networkAvailable,
    platform,
    state,
    stateReason,
  };
}

export async function sendEscPosBytes(
  profile: PrinterProfile,
  bytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  if (profile.connectionType === "network") {
    return transferNetwork(profile, bytes);
  }
  if (profile.connectionType === "bluetooth") {
    return transferBluetooth(bytes);
  }
  if (profile.connectionType === "usb" || profile.connectionType === "builtin") {
    return transferUsb(bytes);
  }
  const caps = await detectPrinterCapabilities();
  if (caps.usbAvailable) return transferUsb(bytes);
  if (caps.bluetoothAvailable) return transferBluetooth(bytes);
  return { ok: false, error: caps.stateReason };
}

export async function kickCashDrawer(profile: PrinterProfile): Promise<{ ok: boolean; error?: string }> {
  const bytes = new EscPosBuilder(profile.paperWidth).kickDrawer().build();
  return sendEscPosBytes(profile, bytes);
}

export async function testPrint(_payload: { width: PrinterPaperWidth; lines: string[] }): Promise<{ ok: boolean; error?: string }> {
  const payload = _payload;
  const caps = await detectPrinterCapabilities();
  if (!caps.escPosAvailable) {
    return { ok: false, error: caps.stateReason };
  }
  const bytes = toEscPos(payload);

  if (caps.usbAvailable) {
    const usb = await transferUsb(bytes);
    if (usb.ok) return usb;
  }

  if (caps.bluetoothAvailable) {
    const bt = await transferBluetooth(bytes);
    if (bt.ok) return bt;
  }

  return { ok: false, error: caps.stateReason };
}

export async function testPrintProfile(profile: PrinterProfile, lines: string[]): Promise<{ ok: boolean; error?: string }> {
  const bytes = buildTestEscPos(profile.paperWidth, lines);
  return sendEscPosBytes(profile, bytes);
}
