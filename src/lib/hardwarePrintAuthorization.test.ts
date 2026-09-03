import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { defaultHospitalityFloor } from "./hospitality";
import { defaultHospitalityHardwarePrefs, resolveHospitalityHardware } from "./hospitalityHardware";
import type { SessionActor } from "./sessionActor";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { authorizePreferencesPatch, requiredPermissionsForPreferencesPatch } from "./settingsAuthorization";

function actor(role: SessionActor["role"]): SessionActor {
  return { userId: `user-${role}`, role, displayName: role };
}

const PRINTER_INPUT = {
  name: "Kitchen printer",
  connectionType: "usb" as const,
  paperWidth: "80mm" as const,
  stationRoles: ["kitchen" as const],
};

function seedHardwarePrefs() {
  const floor = defaultHospitalityFloor();
  usePosStore.setState({
    _hydrated: true,
    sessionActor: actor("owner"),
    auditLogs: [],
    preferences: {
      ...usePosStore.getState().preferences,
      receiptPaperSize: "58mm",
      hospitalityHardware: defaultHospitalityHardwarePrefs("restaurant"),
      hospitalityFloor: floor,
    },
  });
  return floor;
}

describe("hardware printer authorization", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    seedHardwarePrefs();
  });

  it("T1 — manager printer upsert is rejected and does not persist", () => {
    usePosStore.setState({ sessionActor: actor("manager"), auditLogs: [] });
    const before = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
    const result = usePosStore.getState().upsertPrinter(PRINTER_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe("forbidden");
    expect(resolveHospitalityHardware(usePosStore.getState().preferences).printers).toEqual(before);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(true);
  });

  it("T1 — supervisor remove/assign/hardware prefs are rejected", () => {
    usePosStore.setState({ sessionActor: actor("owner") });
    const created = usePosStore.getState().upsertPrinter(PRINTER_INPUT);
    expect(created.ok).toBe(true);
    const printerId = created.printerId!;
    const stationId = usePosStore.getState().preferences.hospitalityFloor!.stations[0]!.id;

    usePosStore.setState({ sessionActor: actor("supervisor"), auditLogs: [] });
    const printersBefore = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
    const floorBefore = usePosStore.getState().preferences.hospitalityFloor;
    const hwBefore = usePosStore.getState().preferences.hospitalityHardware;

    expect(usePosStore.getState().removePrinter(printerId)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(usePosStore.getState().assignStationPrinter(stationId, printerId)).toEqual({
      ok: false,
      errorKey: "forbidden",
    });
    expect(usePosStore.getState().setHospitalityHardwarePrefs({ autoPrintKitchen: false })).toEqual({
      ok: false,
      errorKey: "forbidden",
    });

    expect(resolveHospitalityHardware(usePosStore.getState().preferences).printers).toEqual(printersBefore);
    expect(usePosStore.getState().preferences.hospitalityFloor).toEqual(floorBefore);
    expect(usePosStore.getState().preferences.hospitalityHardware).toEqual(hwBefore);
  });

  it("T2 — owner printer upsert/remove persists", () => {
    const result = usePosStore.getState().upsertPrinter(PRINTER_INPUT);
    expect(result.ok).toBe(true);
    expect(result.printerId).toBeTruthy();
    const printers = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
    expect(printers).toHaveLength(1);
    expect(printers[0]?.name).toBe("Kitchen printer");
    expect(printers[0]?.paperWidth).toBe("80mm");
    expect(printers[0]?.connectionType).toBe("usb");

    const removed = usePosStore.getState().removePrinter(result.printerId!);
    expect(removed.ok).toBe(true);
    expect(resolveHospitalityHardware(usePosStore.getState().preferences).printers).toHaveLength(0);
  });

  it("T2 — owner station assignment and print-behavior prefs persist", () => {
    const created = usePosStore.getState().upsertPrinter(PRINTER_INPUT);
    const stationId = usePosStore.getState().preferences.hospitalityFloor!.stations[0]!.id;
    const assigned = usePosStore.getState().assignStationPrinter(stationId, created.printerId!);
    expect(assigned.ok).toBe(true);
    const station = usePosStore.getState().preferences.hospitalityFloor!.stations.find((s) => s.id === stationId);
    expect(station?.futureHooks?.printerIds).toEqual([created.printerId]);

    const prefs = usePosStore.getState().setHospitalityHardwarePrefs({ autoPrintKitchen: false });
    expect(prefs.ok).toBe(true);
    expect(usePosStore.getState().preferences.hospitalityHardware?.autoPrintKitchen).toBe(false);
  });

  it("T4 — test print stays ungated for manager and does not mutate printers", async () => {
    usePosStore.setState({ sessionActor: actor("manager"), auditLogs: [] });
    const printersBefore = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
    const missing = await usePosStore.getState().testConfiguredPrinter("missing-printer");
    expect(missing).toEqual({ ok: false, error: "Printer not found." });
    expect(resolveHospitalityHardware(usePosStore.getState().preferences).printers).toEqual(printersBefore);
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "auth_forbidden")).toBe(false);
  });

  it("persists Bluetooth pairedDeviceKey on multiple printer profiles", () => {
    const a = usePosStore.getState().upsertPrinter({
      name: "Receipt BT",
      connectionType: "bluetooth",
      paperWidth: "58mm",
      stationRoles: ["receipt"],
      isDefaultReceipt: true,
      pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF",
      bluetoothTransport: "classic",
      pairedDeviceName: "Mobile Printer",
    });
    const b = usePosStore.getState().upsertPrinter({
      name: "Kitchen BT",
      connectionType: "bluetooth",
      paperWidth: "80mm",
      stationRoles: ["kitchen"],
      pairedDeviceKey: "ble:11:22:33:44:55:66",
      bluetoothTransport: "ble",
      pairedDeviceName: "Kitchen Printer",
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const printers = resolveHospitalityHardware(usePosStore.getState().preferences).printers;
    expect(printers).toHaveLength(2);
    expect(printers.find((p) => p.id === a.printerId)?.pairedDeviceKey).toBe("classic:AA:BB:CC:DD:EE:FF");
    expect(printers.find((p) => p.id === b.printerId)?.bluetoothTransport).toBe("ble");
  });

  it("T5 — paper size and printer config share settings.devices", () => {
    expect(requiredPermissionsForPreferencesPatch({ receiptPaperSize: "80mm" })).toEqual(["settings.devices"]);
    expect(requiredPermissionsForPreferencesPatch({ hospitalityHardware: defaultHospitalityHardwarePrefs() })).toEqual([
      "settings.devices",
    ]);

    usePosStore.setState({ sessionActor: actor("manager"), auditLogs: [] });
    const paperBefore = usePosStore.getState().preferences.receiptPaperSize;
    usePosStore.getState().setPreferences({ receiptPaperSize: "80mm" });
    expect(usePosStore.getState().preferences.receiptPaperSize).toBe(paperBefore);
    expect(usePosStore.getState().upsertPrinter(PRINTER_INPUT).ok).toBe(false);

    usePosStore.setState({ sessionActor: actor("owner"), auditLogs: [] });
    usePosStore.getState().setPreferences({ receiptPaperSize: "80mm" });
    expect(usePosStore.getState().preferences.receiptPaperSize).toBe("80mm");
    expect(usePosStore.getState().upsertPrinter({ ...PRINTER_INPUT, paperWidth: "58mm" }).ok).toBe(true);
  });

  it("T6 — unauthorized mutation returns ok:false and never reports success", () => {
    usePosStore.setState({ sessionActor: actor("cashier"), auditLogs: [] });
    const upsert = usePosStore.getState().upsertPrinter(PRINTER_INPUT);
    expect(upsert).toEqual({ ok: false, errorKey: "forbidden" });
    expect(upsert.ok).not.toBe(true);
    expect(upsert.printerId).toBeUndefined();
    expect(authorizePreferencesPatch(actor("cashier"), { receiptPaperSize: "80mm" }).ok).toBe(false);
  });
});
