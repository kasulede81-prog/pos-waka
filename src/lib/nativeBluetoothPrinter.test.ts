import { beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => false);
const getPlatform = vi.fn(() => "web");
const getBluetoothState = vi.fn();
const printEscPos = vi.fn();
const getPairedDevices = vi.fn();
const scanDevices = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    getPlatform: () => getPlatform(),
  },
  registerPlugin: () => ({
    getBluetoothState,
    printEscPos,
    getPairedDevices,
    scanDevices,
  }),
}));

describe("nativeBluetoothPrinter platform gate", () => {
  beforeEach(() => {
    isNativePlatform.mockReset();
    getPlatform.mockReset();
    getBluetoothState.mockReset();
    printEscPos.mockReset();
    getPairedDevices.mockReset();
    scanDevices.mockReset();
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
    expect(result.ok).toBe(true);
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
      expect(denied.error).toBe("Bluetooth permission is required to find printers.");
    }

    printEscPos.mockRejectedValue({ code: "bluetooth_disabled" });
    const off = await printEscPosNative("classic:AA:BB:CC:DD:EE:FF", new Uint8Array([1]));
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toBe("Turn on Bluetooth to connect a printer.");

    printEscPos.mockRejectedValue({ code: "unsupported_device" });
    const bad = await printEscPosNative("ble:11:22:33:44:55:66", new Uint8Array([1]), "ble");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBe("This Bluetooth device does not expose a supported printer connection.");
    }
  });

  it("lists every paired device, including non-printer names", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    getPairedDevices.mockResolvedValue({
      devices: [
        {
          id: "classic:AA:BB:CC:DD:EE:FF",
          name: "Mobile Printer",
          transport: "classic",
          bonded: true,
          likelyPrinter: true,
          fromPairedList: true,
        },
        {
          id: "classic:11:22:33:44:55:66",
          name: "Speaker",
          transport: "classic",
          bonded: true,
          likelyPrinter: false,
          fromPairedList: true,
        },
        {
          id: "ble:AA:11:22:33:44:55",
          name: "POS-Printer",
          transport: "ble",
          bonded: true,
          likelyPrinter: true,
          fromPairedList: true,
        },
      ],
    });
    const { listPairedBluetoothPrinterDevices } = await import("./nativeBluetoothPrinter");
    const listed = await listPairedBluetoothPrinterDevices();
    expect(listed.map((d) => d.name)).toEqual(["Mobile Printer", "Speaker", "POS-Printer"]);
  });

  it("keeps nearby discovery separate from the paired list", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    scanDevices.mockResolvedValue({
      devices: [
        {
          id: "classic:DE:AD:BE:EF:00:01",
          name: "XP-P300",
          transport: "classic",
          bonded: false,
          likelyPrinter: true,
          fromPairedList: false,
        },
      ],
    });
    const { scanBluetoothPrinterDevices } = await import("./nativeBluetoothPrinter");
    const nearby = await scanBluetoothPrinterDevices(12000);
    expect(scanDevices).toHaveBeenCalledWith({ timeoutMs: 12000 });
    expect(nearby).toHaveLength(1);
    expect(nearby[0]?.name).toBe("XP-P300");
  });

  it("keeps the real RFCOMM exception instead of Mobile Printer", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    printEscPos.mockRejectedValue({
      code: "classic_spp_failed",
      message: "RFCOMM connection failed\n\nIOException\nread failed, socket might closed",
      data: {
        ok: false,
        stage: "RFCOMM_CONNECT",
        transport: "classic",
        errorType: "IOException",
        errorMessage: "read failed, socket might closed",
        connectionSucceeded: false,
        bytesWritten: 0,
        socketClosed: true,
      },
    });
    const { printEscPosNative } = await import("./nativeBluetoothPrinter");
    const result = await printEscPosNative("classic:AA:BB:CC:DD:EE:FF", new Uint8Array([1]), "classic");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("IOException");
    expect(result.error).toContain("read failed, socket might closed");
    expect(result.errorType).toBe("IOException");
    expect(result.stage).toBe("RFCOMM_CONNECT");
    expect(result.error).not.toBe("Could not connect to Mobile Printer.");
  });

  it("sends the minimal Classic diagnostic payload", async () => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue("android");
    printEscPos.mockResolvedValue({
      ok: true,
      connectionSucceeded: true,
      writeSucceeded: true,
      flushSucceeded: true,
      socketClosed: true,
      bytesWritten: 13,
    });
    const { printClassicSppDiagnostic, CLASSIC_SPP_DIAGNOSTIC_BYTES } = await import("./nativeBluetoothPrinter");
    expect(Array.from(CLASSIC_SPP_DIAGNOSTIC_BYTES)).toEqual([
      0x1b, 0x40, 0x57, 0x41, 0x4b, 0x41, 0x20, 0x54, 0x45, 0x53, 0x54, 0x0a, 0x0a,
    ]);
    const result = await printClassicSppDiagnostic("classic:AA:BB:CC:DD:EE:FF");
    expect(result.ok).toBe(true);
    expect(printEscPos).toHaveBeenCalledWith({
      deviceId: "classic:AA:BB:CC:DD:EE:FF",
      data: Array.from(CLASSIC_SPP_DIAGNOSTIC_BYTES),
      mode: "classic",
    });
    const payload = printEscPos.mock.calls[0][0] as { data: number[] };
    expect(payload.data).toHaveLength(13);
    expect(payload.data[0]).toBe(0x1b);
    expect(payload.data[1]).toBe(0x40);
    expect(payload.data.every((n) => n >= 0 && n <= 255)).toBe(true);
  });
});
