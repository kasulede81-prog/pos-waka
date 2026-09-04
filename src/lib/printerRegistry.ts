import type {
  HospitalityFloorState,
  KitchenStation,
  KitchenStationType,
  PrinterProfile,
  PrinterStationRole,
  ShopPreferences,
} from "../types";
import { resolveHospitalityHardware } from "./hospitalityHardware";

const STATION_TYPE_TO_ROLE: Record<KitchenStationType, PrinterStationRole> = {
  kitchen: "kitchen",
  bar: "bar",
  grill: "grill",
  coffee: "coffee",
  dessert: "dessert",
  pizza: "pizza",
  fryer: "fryer",
  other: "other",
};

export function stationTypeToPrinterRole(stationType: KitchenStationType): PrinterStationRole {
  return STATION_TYPE_TO_ROLE[stationType] ?? "other";
}

export function enabledPrinters(prefs: ShopPreferences): PrinterProfile[] {
  return resolveHospitalityHardware(prefs).printers.filter((p) => p.isEnabled);
}

export function resolveDefaultReceiptPrinter(prefs: ShopPreferences): PrinterProfile | null {
  const printers = enabledPrinters(prefs);
  return printers.find((p) => p.isDefaultReceipt) ?? printers.find((p) => p.stationRoles.includes("receipt")) ?? printers[0] ?? null;
}

/** Profile Test / Hardware Test should use — persisted printers only. */
export function resolveConfiguredHardwareTestPrinter(prefs: ShopPreferences): PrinterProfile | null {
  const hw = resolveHospitalityHardware(prefs);
  return (
    resolveDefaultReceiptPrinter(prefs) ??
    hw.printers.find((p) => p.connectionType === "bluetooth" && Boolean(p.pairedDeviceKey) && p.isEnabled) ??
    hw.printers.find((p) => p.isEnabled && (p.connectionType === "network" || p.connectionType === "usb")) ??
    null
  );
}

export type BluetoothBindDevice = {
  id: string;
  name: string;
  transport: "classic" | "ble";
};

/**
 * Build the upsert payload so "Use this printer" creates/updates the receipt
 * PrinterProfile checkout and Test actually read. Does not persist by itself.
 */
export function bindBluetoothDeviceToReceiptPrinterInput(
  existing: PrinterProfile | undefined,
  device: BluetoothBindDevice,
  paperWidth: "58mm" | "80mm" = "58mm",
): {
  id?: string;
  name: string;
  connectionType: "bluetooth";
  paperWidth: "58mm" | "80mm";
  stationRoles: PrinterStationRole[];
  isDefaultReceipt: true;
  pairedDeviceKey: string;
  bluetoothTransport: "classic" | "ble";
  pairedDeviceName: string;
} {
  const roles: PrinterStationRole[] =
    existing?.stationRoles.includes("receipt") ? existing.stationRoles : ["receipt"];
  return {
    id: existing?.id,
    name: device.name.trim() || existing?.name || "Receipt printer",
    connectionType: "bluetooth",
    paperWidth: existing?.paperWidth ?? paperWidth,
    stationRoles: roles,
    isDefaultReceipt: true,
    pairedDeviceKey: device.id,
    bluetoothTransport: device.transport,
    pairedDeviceName: device.name,
  };
}

export function resolvePrinterForStation(
  prefs: ShopPreferences,
  floor: HospitalityFloorState | null | undefined,
  stationId: string,
  stationType: KitchenStationType,
): PrinterProfile | null {
  const printers = enabledPrinters(prefs);
  if (!printers.length) return null;
  const station = floor?.stations.find((s) => s.id === stationId);
  const assignedIds = station?.futureHooks?.printerIds ?? [];
  for (const id of assignedIds) {
    const match = printers.find((p) => p.id === id);
    if (match) return match;
  }
  const role = stationTypeToPrinterRole(stationType);
  const byRole = printers.find((p) => p.stationRoles.includes(role));
  if (byRole) return byRole;
  if (role === "bar") return printers.find((p) => p.stationRoles.includes("bar")) ?? null;
  return printers.find((p) => !p.stationRoles.includes("receipt")) ?? printers[0] ?? null;
}

export function assignPrinterToStation(
  floor: HospitalityFloorState,
  stationId: string,
  printerId: string | null,
): HospitalityFloorState {
  return {
    ...floor,
    stations: floor.stations.map((s) => {
      if (s.id !== stationId) return s;
      const hooks = { ...(s.futureHooks ?? {}) };
      if (!printerId) {
        delete hooks.printerIds;
      } else {
        hooks.printerIds = [printerId];
      }
      return { ...s, futureHooks: Object.keys(hooks).length ? hooks : null };
    }),
  };
}

export function upsertPrinterProfile(prefs: ShopPreferences, profile: PrinterProfile): ShopPreferences {
  const hw = resolveHospitalityHardware(prefs);
  const idx = hw.printers.findIndex((p) => p.id === profile.id);
  const printers = [...hw.printers];
  if (idx >= 0) printers[idx] = profile;
  else printers.push(profile);
  if (profile.isDefaultReceipt) {
    for (let i = 0; i < printers.length; i++) {
      if (printers[i].id !== profile.id) printers[i] = { ...printers[i], isDefaultReceipt: false };
    }
  }
  return {
    ...prefs,
    hospitalityHardware: { ...hw, printers },
  };
}

export function removePrinterProfile(prefs: ShopPreferences, printerId: string): ShopPreferences {
  const hw = resolveHospitalityHardware(prefs);
  return {
    ...prefs,
    hospitalityHardware: {
      ...hw,
      printers: hw.printers.filter((p) => p.id !== printerId),
    },
  };
}

export function stationLabel(station: KitchenStation): string {
  return `${station.name} (${station.stationType})`;
}
