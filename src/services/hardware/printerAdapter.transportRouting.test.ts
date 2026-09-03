import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterProfile } from "../../types";

const isNativeBluetoothPrinterAvailable = vi.fn();
const printEscPosNative = vi.fn();
const printEscPosWebBluetooth = vi.fn();
const printEscPosNativeNetwork = vi.fn();

vi.mock("../../lib/nativeBluetoothPrinter", () => ({
  isNativeBluetoothPrinterAvailable: (...args: unknown[]) => isNativeBluetoothPrinterAvailable(...args),
  printEscPosNative: (...args: unknown[]) => printEscPosNative(...args),
}));

vi.mock("../../lib/webBluetoothPrinter", () => ({
  printEscPosWebBluetooth: (...args: unknown[]) => printEscPosWebBluetooth(...args),
}));

vi.mock("../../lib/nativeNetworkPrinter", () => ({
  isNativeNetworkPrinterAvailable: async () => false,
  printEscPosNativeNetwork: (...args: unknown[]) => printEscPosNativeNetwork(...args),
  testNativeNetworkPrinter: async () => ({ ok: false, error: "Could not connect to printer" }),
}));

import { sendEscPosBytes } from "./printerAdapter";
import { CLASSIC_IN_BROWSER_ERROR, NETWORK_NEEDS_BRIDGE_ERROR } from "./hardwareTransport";

const classic: PrinterProfile = {
  id: "p-classic",
  name: "Mobile Printer",
  connectionType: "bluetooth",
  paperWidth: "58mm",
  stationRoles: ["receipt"],
  isEnabled: true,
  pairedDeviceKey: "classic:AA:BB:CC:DD:EE:FF",
  bluetoothTransport: "classic",
};

describe("printerAdapter transport routing", () => {
  beforeEach(() => {
    isNativeBluetoothPrinterAvailable.mockReset();
    printEscPosNative.mockReset();
    printEscPosWebBluetooth.mockReset();
    printEscPosNativeNetwork.mockReset();
    isNativeBluetoothPrinterAvailable.mockResolvedValue(false);
    printEscPosNative.mockResolvedValue({ ok: true });
    printEscPosWebBluetooth.mockResolvedValue({ ok: true });
  });

  it("sends Classic jobs to the native plugin on Android", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    const bytes = new Uint8Array([0x1b, 0x40]);
    const result = await sendEscPosBytes(classic, bytes);
    expect(result.ok).toBe(true);
    expect(printEscPosNative).toHaveBeenCalledWith("classic:AA:BB:CC:DD:EE:FF", bytes, "classic");
    expect(printEscPosWebBluetooth).not.toHaveBeenCalled();
  });

  it("does not open Web Bluetooth for a Classic profile in a browser", async () => {
    const result = await sendEscPosBytes(classic, new Uint8Array([1]));
    expect(result.ok).toBe(false);
    expect(result.error).toBe(CLASSIC_IN_BROWSER_ERROR);
    expect(printEscPosWebBluetooth).not.toHaveBeenCalled();
    expect(printEscPosNative).not.toHaveBeenCalled();
  });

  it("keeps network jobs off Bluetooth transports", async () => {
    isNativeBluetoothPrinterAvailable.mockResolvedValue(true);
    const result = await sendEscPosBytes(
      {
        id: "lan",
        name: "LAN",
        connectionType: "network",
        paperWidth: "80mm",
        stationRoles: ["receipt"],
        isEnabled: true,
        networkHost: "192.168.1.50",
        networkPort: 9100,
      },
      new Uint8Array([1]),
    );
    expect(printEscPosNative).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe(NETWORK_NEEDS_BRIDGE_ERROR);
  });
});
