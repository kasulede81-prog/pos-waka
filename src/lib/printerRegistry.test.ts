import { describe, expect, it } from "vitest";
import { resolvePrinterForStation, stationTypeToPrinterRole } from "./printerRegistry";
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
});
