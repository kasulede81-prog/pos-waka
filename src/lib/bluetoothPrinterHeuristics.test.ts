import { describe, expect, it } from "vitest";
import {
  bluetoothDeviceLooksLikePrinter,
  extractBluetoothAddress,
  formatBluetoothDeviceId,
  isBluetoothAddress,
  mapNativeBluetoothPrinterError,
  parseBluetoothDeviceId,
  partitionBluetoothDiscovery,
  preferClassicBluetoothRows,
} from "./bluetoothPrinterHeuristics";

describe("bluetoothPrinterHeuristics", () => {
  it("marks common thermal names as likely printers without hiding others", () => {
    expect(bluetoothDeviceLooksLikePrinter("Mobile Printer")).toBe(true);
    expect(bluetoothDeviceLooksLikePrinter("Xprinter XP-58")).toBe(true);
    expect(bluetoothDeviceLooksLikePrinter("JBL Flip", "audio")).toBe(false);
    expect(bluetoothDeviceLooksLikePrinter("Unknown", "imaging")).toBe(true);
  });

  it("extracts a MAC from classic: and ble: ids the same way Java does", () => {
    expect(extractBluetoothAddress("classic:AA:BB:CC:DD:EE:FF")).toBe("AA:BB:CC:DD:EE:FF");
    expect(extractBluetoothAddress("ble:11:22:33:44:55:66")).toBe("11:22:33:44:55:66");
    expect(extractBluetoothAddress("aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(extractBluetoothAddress("classic:aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(extractBluetoothAddress("classic:not-a-mac")).toBe("NOT-A-MAC");
    expect(isBluetoothAddress(extractBluetoothAddress("classic:AA:BB:CC:DD:EE:FF"))).toBe(true);
    expect(isBluetoothAddress(extractBluetoothAddress("classic:not-a-mac"))).toBe(false);
    expect(isBluetoothAddress("AA:BB:CC:DD:EE:FF")).toBe(true);
    expect(isBluetoothAddress("AA-BB-CC-DD-EE-FF")).toBe(false);
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
    expect(mapNativeBluetoothPrinterError("bluetooth_disabled", "x")).toBe(
      "Turn on Bluetooth to connect a printer.",
    );
    expect(mapNativeBluetoothPrinterError("permission_denied", "x")).toBe(
      "Bluetooth permission is required to find printers.",
    );
    expect(mapNativeBluetoothPrinterError("unsupported_device", "x")).toBe(
      "This Bluetooth device does not expose a supported printer connection.",
    );
    expect(mapNativeBluetoothPrinterError("classic_browser_unsupported", "x")).toBe(
      "Bluetooth Classic printers cannot be accessed directly from this browser. Use the WAKA Android app.",
    );
    expect(mapNativeBluetoothPrinterError("session_lost", "x")).toBe("Select your BLE printer again.");
    expect(mapNativeBluetoothPrinterError("chooser_cancelled", "x")).toBe(
      "No compatible BLE device was selected.",
    );
    expect(mapNativeBluetoothPrinterError("pairing_required", "x")).toBe(
      "Pair this printer in Android Bluetooth settings, then select it from Paired.",
    );
  });

  it("splits paired and nearby devices without hiding non-printer names", () => {
    const { paired, nearby } = partitionBluetoothDiscovery([
      { id: "classic:AA", name: "Mobile Printer", fromPairedList: true, bonded: true },
      { id: "classic:BB", name: "Speaker", fromPairedList: false, bonded: false },
      { id: "ble:CC", name: "POS-Printer", fromPairedList: false, bonded: false },
    ]);
    expect(paired.map((d) => d.id)).toEqual(["classic:AA"]);
    expect(nearby.map((d) => d.name)).toEqual(["Speaker", "POS-Printer"]);
  });

  it("drops a BLE duplicate when the same MAC already has a Classic row", () => {
    const rows = preferClassicBluetoothRows([
      { id: "classic:AA:BB:CC:DD:EE:FF", name: "Mobile Printer" },
      { id: "ble:AA:BB:CC:DD:EE:FF", name: "Mobile Printer" },
    ]);
    expect(rows.map((d) => d.id)).toEqual(["classic:AA:BB:CC:DD:EE:FF"]);
  });

  it("keeps multiple paired printers selectable", () => {
    const { paired, nearby } = partitionBluetoothDiscovery([
      { id: "classic:AA", name: "Mobile Printer", fromPairedList: true, bonded: true },
      { id: "classic:CC", name: "Counter Printer", fromPairedList: true, bonded: true },
      { id: "ble:DD", name: "Kitchen BLE", fromPairedList: true, bonded: true },
      { id: "classic:BB", name: "Speaker", fromPairedList: false, bonded: false },
    ]);
    expect(paired.map((d) => d.name)).toEqual(["Mobile Printer", "Counter Printer", "Kitchen BLE"]);
    expect(nearby.map((d) => d.name)).toEqual(["Speaker"]);
  });
});
