import { describe, expect, it } from "vitest";
import {
  bindBluetoothDeviceToReceiptPrinterInput,
  resolveConfiguredHardwareTestPrinter,
  resolveDefaultReceiptPrinter,
  resolvePrinterForStation,
  stationTypeToPrinterRole,
} from "./printerRegistry";
import type { HospitalityFloorState, PrinterProfile, ShopPreferences } from "../types";
import { defaultHospitalityHardwarePrefs } from "./hospitalityHardware";

function prefsWithPrinters(printers: PrinterProfile[]): ShopPreferences {
  return {
    businessType: "restaurant",
    kioskQuickSell: false,
    onboardingDone: true,
    hospitalityHardware: {
      ...defaultHospitalityHardwarePrefs("restaurant"),
      printers,
    },
  };
}

const floor: HospitalityFloorState = {
  areas: [],
  tables: [],
  sessions: [],
  stations: [
    { id: "st-bar", name: "Bar", stationType: "bar", sortOrder: 0, isActive: true },
    { id: "st-kit", name: "Kitchen", stationType: "kitchen", sortOrder: 1, isActive: true },
  ],
};

describe("printerRegistry", () => {
  it("maps station types to printer roles", () => {
    expect(stationTypeToPrinterRole("bar")).toBe("bar");
    expect(stationTypeToPrinterRole("coffee")).toBe("coffee");
  });

  it("resolves printer by station role when no explicit assignment", () => {
    const printers: PrinterProfile[] = [
      {
        id: "p-bar",
        name: "Bar printer",
        connectionType: "usb",
        paperWidth: "80mm",
        stationRoles: ["bar"],
        isEnabled: true,
      },
    ];
    const p = resolvePrinterForStation(prefsWithPrinters(printers), floor, "st-bar", "bar");
    expect(p?.id).toBe("p-bar");
  });

  it("prefers explicit station printer assignment", () => {
    const printers: PrinterProfile[] = [
      {
        id: "p-kitchen",
        name: "Kitchen",
        connectionType: "usb",
        paperWidth: "80mm",
        stationRoles: ["kitchen"],
        isEnabled: true,
      },
      {
        id: "p-special",
        name: "Special",
        connectionType: "usb",
        paperWidth: "80mm",
        stationRoles: ["other"],
        isEnabled: true,
      },
    ];
    const assignedFloor: HospitalityFloorState = {
      ...floor,
      stations: floor.stations.map((s) =>
        s.id === "st-bar" ? { ...s, futureHooks: { printerIds: ["p-special"] } } : s,
      ),
    };
    const p = resolvePrinterForStation(prefsWithPrinters(printers), assignedFloor, "st-bar", "bar");
    expect(p?.id).toBe("p-special");
  });

  it("Use this printer builds a persisted receipt profile payload", () => {
    const input = bindBluetoothDeviceToReceiptPrinterInput(
      undefined,
      { id: "classic:AA:BB:CC:DD:EE:FF", name: "RPP02N", transport: "classic" },
      "58mm",
    );
    expect(input.connectionType).toBe("bluetooth");
    expect(input.stationRoles).toEqual(["receipt"]);
    expect(input.isDefaultReceipt).toBe(true);
    expect(input.pairedDeviceKey).toBe("classic:AA:BB:CC:DD:EE:FF");
    expect(input.bluetoothTransport).toBe("classic");
    expect(input.pairedDeviceName).toBe("RPP02N");
    expect(input.paperWidth).toBe("58mm");
  });

  it("updates the existing receipt printer instead of inventing a second one", () => {
    const existing: PrinterProfile = {
      id: "printer-receipt-1",
      name: "Front counter",
      connectionType: "bluetooth",
      paperWidth: "58mm",
      stationRoles: ["receipt"],
      isDefaultReceipt: true,
      isEnabled: true,
    };
    const input = bindBluetoothDeviceToReceiptPrinterInput(existing, {
      id: "classic:11:22:33:44:55:66",
      name: "MP-58N-8012",
      transport: "classic",
    });
    expect(input.id).toBe("printer-receipt-1");
    expect(input.pairedDeviceKey).toBe("classic:11:22:33:44:55:66");
    const prefs = prefsWithPrinters([{ ...existing, pairedDeviceKey: input.pairedDeviceKey }]);
    expect(resolveDefaultReceiptPrinter(prefs)?.pairedDeviceKey).toBe("classic:11:22:33:44:55:66");
    expect(resolveConfiguredHardwareTestPrinter(prefs)?.id).toBe("printer-receipt-1");
  });
});
