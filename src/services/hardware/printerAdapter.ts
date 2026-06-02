/**
 * Thermal / receipt printer adapter (Bluetooth, USB). Web APIs only — no Sunmi SDK yet.
 */
export type PrinterPaperWidth = "58mm" | "80mm";

export type PrinterPlatform = "web" | "android" | "ios" | "electron" | "unknown";

/** Production certification state — do not claim "ready" unless SUPPORTED. */
export type PrinterCapabilityState = "SUPPORTED" | "PARTIAL" | "UNAVAILABLE";

export type PrinterCapabilities = {
  bluetoothAvailable: boolean;
  usbAvailable: boolean;
  sunmiBuiltIn: boolean;
  escPosAvailable: boolean;
  platform: PrinterPlatform;
  state: PrinterCapabilityState;
  stateReason: string;
};

const ESC_POS_INIT = [0x1b, 0x40];
const ESC_POS_ALIGN_LEFT = [0x1b, 0x61, 0x00];
const ESC_POS_ALIGN_CENTER = [0x1b, 0x61, 0x01];
const ESC_POS_CUT_PARTIAL = [0x1d, 0x56, 0x42, 0x03];
const ESC_POS_FEED_4 = [0x1b, 0x64, 0x04];

const BT_PRINTER_SERVICES = [0xffe0, 0x18f0];
const BT_PRINTER_CHARS = [0xffe1, 0x2af1];

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
      stateReason: "Use system print dialog (Receipt Print). USB/BT thermal needs WebUSB/Web Bluetooth in Chromium.",
      escPosAvailable: false,
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
  const encoder = new TextEncoder();
  const widthLabel = payload.width === "58mm" ? "WAKA POS [58mm]" : "WAKA POS [80mm]";
  const header = `${widthLabel}\n`;
  const body = `${payload.lines.join("\n")}\n\n`;
  const bytes = [
    ...ESC_POS_INIT,
    ...ESC_POS_ALIGN_CENTER,
    ...Array.from(encoder.encode(header)),
    ...ESC_POS_ALIGN_LEFT,
    ...Array.from(encoder.encode(body)),
    ...ESC_POS_FEED_4,
    ...ESC_POS_CUT_PARTIAL,
  ];
  return new Uint8Array(bytes);
}

export async function detectPrinterCapabilities(): Promise<PrinterCapabilities> {
  const hasNavigator = typeof navigator !== "undefined";
  const bluetoothAvailable = hasNavigator && "bluetooth" in navigator;
  const usbAvailable = hasNavigator && "usb" in navigator;
  const platform = resolvePlatform();
  const sunmiBuiltIn = false;
  const { state, stateReason, escPosAvailable } = resolveCapabilityState(platform, bluetoothAvailable, usbAvailable);
  return {
    bluetoothAvailable,
    usbAvailable,
    sunmiBuiltIn,
    escPosAvailable,
    platform,
    state,
    stateReason,
  };
}

export async function testPrint(_payload: { width: PrinterPaperWidth; lines: string[] }): Promise<{ ok: boolean; error?: string }> {
  const payload = _payload;
  const caps = await detectPrinterCapabilities();
  if (!caps.escPosAvailable) {
    return { ok: false, error: caps.stateReason };
  }
  const bytes = toEscPos(payload);

  if (caps.usbAvailable && typeof navigator !== "undefined" && "usb" in navigator) {
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
      return {
        ok: false,
        error: error instanceof Error ? error.message : "USB thermal print failed.",
      };
    }
  }

  if (caps.bluetoothAvailable && typeof navigator !== "undefined" && "bluetooth" in navigator) {
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
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Bluetooth thermal print failed.",
      };
    }
  }

  return { ok: false, error: caps.stateReason };
}
