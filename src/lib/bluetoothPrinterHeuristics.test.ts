import { describe, expect, it } from "vitest";
import {
  bluetoothDeviceLooksLikePrinter,
  formatBluetoothDeviceId,
  mapNativeBluetoothPrinterError,
  parseBluetoothDeviceId,
} from "./bluetoothPrinterHeuristics";

describe("bluetoothPrinterHeuristics", () => {
  it("marks common thermal names as likely printers without hiding others", () => {
    expect(bluetoothDeviceLooksLikePrinter("Mobile Printer")).toBe(true);
    expect(bluetoothDeviceLooksLikePrinter("Xprinter XP-58")).toBe(true);
    expect(bluetoothDeviceLooksLikePrinter("JBL Flip", "audio")).toBe(false);
    expect(bluetoothDeviceLooksLikePrinter("Unknown", "imaging")).toBe(true);
  });

  it("parses classic and ble device ids", () => {
    expect(parseBluetoothDeviceId("classic:AA:BB:CC:DD:EE:FF")).toEqual({
      transport: "classic",
      address: "AA:BB:CC:DD:EE:FF",
    });
    expect(parseBluetoothDeviceId("ble:11:22:33:44:55:66")).toEqual({
      transport: "ble",
      address: "11:22:33:44:55:66",
    });
    expect(parseBluetoothDeviceId("")).toBeNull();
    expect(formatBluetoothDeviceId("classic", "aa:bb:cc:dd:ee:ff")).toBe("classic:AA:BB:CC:DD:EE:FF");
  });

  it("maps native error codes to operator copy", () => {
    expect(mapNativeBluetoothPrinterError("bluetooth_disabled", "x")).toBe("Bluetooth is disabled.");
    expect(mapNativeBluetoothPrinterError("permission_denied", "x")).toBe("Bluetooth permission is required.");
    expect(mapNativeBluetoothPrinterError("unsupported_device", "x")).toBe(
      "This Bluetooth device does not expose a supported printer connection.",
    );
    expect(mapNativeBluetoothPrinterError("classic_browser_unsupported", "x")).toContain(
      "Mac Chrome cannot access Bluetooth Classic",
    );
  });
});
