import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterProfile } from "../../types";

const isNativeBluetoothPrinterAvailable = vi.fn();
const isNativeBluetoothPrinterPlatform = vi.fn();
const printEscPosNative = vi.fn();

vi.mock("../../lib/nativeBluetoothPrinter", () => ({
  isNativeBluetoothPrinterAvailable: (...args: unknown[]) => isNativeBluetoothPrinterAvailable(...args),
  isNativeBluetoothPrinterPlatform: (...args: unknown[]) => isNativeBluetoothPrinterPlatform(...args),
  printEscPosNative: (...args: unknown[]) => printEscPosNative(...args),
}));

import { detectPrinterCapabilities, sendEscPosBytes, testPrint, testPrintProfile } from "./printerAdapter";

const btProfile = (patch: Partial<PrinterProfile> = {}): PrinterProfile => ({
  id: "p-bt",
  name: "Mobile Printer",
  connectionType: "bluetooth",
  paperWidth: "58mm",
  stationRoles: ["receipt"],
  isEnabled: true,
  pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF",
  bluetoothTransport: "classic",
  pairedDeviceName: "Mobile Printer",
  ...patch,
});

const netProfile = (): PrinterProfile => ({
  id: "p-lan",
  name: "LAN",
  connectionType: "network",
  paperWidth: "80mm",
  stationRoles: ["receipt"],
  isEnabled: true,
  networkHost: "192.168.1.50",
  networkPort: 9100,
});

describe("printerAdapter native Bluetooth", () => {
  beforeEach(() => {
    isNativeBluetoothPrinterAvailable.mockReset();
    isNativeBluetoothPrinterPlatform.mockReset();
    printEscPosNative.mockReset();
    isNativeBluetoothPrinterAvailable.mockResolvedValue(false);
    isNativeBluetoothPrinterPlatform.mockReturnValue(false);
  });

  it("does not claim native transport when the plugin is unavailable", async () => {
    const caps = await detectPrinterCapabilities();
    expect(caps.nativeBluetoothPrinter).toBe(false);
    expect(caps.escPosAvailable).toBe(false);
  });

  it("reports SUPPORTED when Android native transport exists", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    const caps = await detectPrinterCapabilities();
    expect(caps.nativeBluetoothPrinter).toBe(true);
    expect(caps.classicSppSupported).toBe(true);
    expect(caps.escPosAvailable).toBe(true);
    expect(caps.state).toBe("SUPPORTED");
    expect(caps.stateReason).not.toMatch(/Native thermal SDK not installed/);
  });

  it("prints via native plugin when a Bluetooth profile has a saved device", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    printEscPosNative.mockResolvedValue({ ok: true });
    const bytes = new Uint8Array([0x1b, 0x40, 0x0a]);
    const result = await sendEscPosBytes(btProfile(), bytes);
    expect(result.ok).toBe(true);
    expect(printEscPosNative).toHaveBeenCalledWith("classic:AA:BB:CC:DD:EE:FF", bytes, "classic");
  });

  it("fails clearly when Bluetooth profile has no saved device", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    const result = await sendEscPosBytes(btProfile({ pairedDeviceKey: null }), new Uint8Array([1]));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Select a Bluetooth printer in Hardware settings.");
    expect(printEscPosNative).not.toHaveBeenCalled();
  });

  it("propagates native print failure", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    printEscPosNative.mockResolvedValue({
      ok: false,
      error: "Could not connect to Mobile Printer.",
      code: "connect_failed",
    });
    const result = await sendEscPosBytes(btProfile(), new Uint8Array([1, 2]));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Could not connect to Mobile Printer.");
  });

  it("maps permission and disabled errors through testPrintProfile", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    printEscPosNative.mockResolvedValue({
      ok: false,
      error: "Bluetooth permission is required to find printers.",
      code: "permission_denied",
    });
    const denied = await testPrintProfile(btProfile(), ["Test"]);
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe("Bluetooth permission is required to find printers.");

    printEscPosNative.mockResolvedValue({
      ok: false,
      error: "Turn on Bluetooth to connect a printer.",
      code: "bluetooth_disabled",
    });
    const off = await testPrintProfile(btProfile(), ["Test"]);
    expect(off.error).toBe("Turn on Bluetooth to connect a printer.");

    printEscPosNative.mockResolvedValue({
      ok: false,
      error: "This Bluetooth device does not expose a supported printer connection.",
      code: "unsupported_device",
    });
    const bad = await testPrintProfile(btProfile(), ["Test"]);
    expect(bad.error).toContain("does not expose a supported printer connection");
  });

  it("does not open Web Bluetooth chooser from testPrint on native Android", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    const result = await testPrint({ width: "58mm", lines: ["hello"] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Select a Bluetooth printer in Hardware settings.");
    expect(printEscPosNative).not.toHaveBeenCalled();
  });

  it("does not send Bluetooth jobs over the network path", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    printEscPosNative.mockResolvedValue({ ok: true });
    const result = await sendEscPosBytes(netProfile(), new Uint8Array([9]));
    expect(printEscPosNative).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/LAN ESC\/POS|Network printer/);
  });

  it("keeps USB path off native Bluetooth", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    const usb: PrinterProfile = {
      id: "usb",
      name: "USB",
      connectionType: "usb",
      paperWidth: "80mm",
      stationRoles: ["receipt"],
      isEnabled: true,
    };
    const result = await sendEscPosBytes(usb, new Uint8Array([1]));
    expect(printEscPosNative).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
