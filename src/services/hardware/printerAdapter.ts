/**
 * Thermal / receipt printer adapter (Bluetooth, USB, Sunmi). Implement per platform.
 * Queue-aware: callers should use print queue when offline.
 */
export type PrinterPaperWidth = "58mm" | "80mm";

export type PrinterCapabilities = {
  bluetoothAvailable: boolean;
  usbAvailable: boolean;
  sunmiBuiltIn: boolean;
};

export async function detectPrinterCapabilities(): Promise<PrinterCapabilities> {
  return { bluetoothAvailable: false, usbAvailable: false, sunmiBuiltIn: false };
}

export async function testPrint(_payload: { width: PrinterPaperWidth; lines: string[] }): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Printer adapter not configured on this build." };
}
