import { beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => false);
const getPlatform = vi.fn(() => "web");
const getBluetoothState = vi.fn();
const printEscPos = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    getPlatform: () => getPlatform(),
  },
  registerPlugin: () => ({
    getBluetoothState,
    printEscPos,
  }),
}));

describe("nativeBluetoothPrinter platform gate", () => {
  beforeEach(() => {
    isNativePlatform.mockReset();
    getPlatform.mockReset();
    getBluetoothState.mockReset();
    printEscPos.mockReset();
    isNativePlatform.mockReturnValue(false);
    getPlatform.mockReturnValue("web");
  });

  it("is unavailable when Capacitor is not Android", async () => {
    const { isNativeBluetoothPrinterAvailable, isNativeBluetoothPrinterPlatform } = await import(
      "./nativeBluetoothPrinter"
    );
    expect(isNativeBluetoothPrinterPlatform()).toBe(false);
    await expect(isNativeBluetoothPrinterAvailable()).resolves.toBe(false);
    expect(getBluetoothState).not.toHaveBeenCalled();
  });

  it("is available when Android plugin reports native transport", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    getBluetoothState.mockResolvedValue({ supported: true, nativeTransport: true });
    const { isNativeBluetoothPrinterAvailable, isNativeBluetoothPrinterPlatform } = await import(
      "./nativeBluetoothPrinter"
    );
    expect(isNativeBluetoothPrinterPlatform()).toBe(true);
    await expect(isNativeBluetoothPrinterAvailable()).resolves.toBe(true);
  });

  it("treats a missing plugin as unavailable", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    getBluetoothState.mockRejectedValue(new Error("plugin not implemented"));
    const { isNativeBluetoothPrinterAvailable } = await import("./nativeBluetoothPrinter");
    await expect(isNativeBluetoothPrinterAvailable()).resolves.toBe(false);
  });

  it("sends exact ESC/POS bytes on native print success", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    printEscPos.mockResolvedValue({ ok: true, bytesWritten: 3 });
    const { printEscPosNative } = await import("./nativeBluetoothPrinter");
    const bytes = new Uint8Array([0x1b, 0x40, 0x0a]);
    const result = await printEscPosNative("classic:AA:BB:CC:DD:EE:FF", bytes, "classic");
    expect(result).toEqual({ ok: true });
    expect(printEscPos).toHaveBeenCalledWith({
      deviceId: "classic:AA:BB:CC:DD:EE:FF",
      data: [0x1b, 0x40, 0x0a],
      mode: "classic",
    });
  });

  it("maps native print failures without claiming success", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    printEscPos.mockRejectedValue({ code: "permission_denied", message: "denied" });
    const { printEscPosNative } = await import("./nativeBluetoothPrinter");
    const denied = await printEscPosNative("classic:AA:BB:CC:DD:EE:FF", new Uint8Array([1]));
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("Bluetooth permission is required.");
    }

    printEscPos.mockRejectedValue({ code: "bluetooth_disabled" });
    const off = await printEscPosNative("classic:AA:BB:CC:DD:EE:FF", new Uint8Array([1]));
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toBe("Bluetooth is disabled.");

    printEscPos.mockRejectedValue({ code: "unsupported_device" });
    const bad = await printEscPosNative("ble:11:22:33:44:55:66", new Uint8Array([1]), "ble");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBe("This Bluetooth device does not expose a supported printer connection.");
    }
  });
});
