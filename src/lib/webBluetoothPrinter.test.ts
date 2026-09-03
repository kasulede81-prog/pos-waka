import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLASSIC_CHROME_CHOOSER_ERROR,
  printEscPosWebBluetooth,
  requestWebBluetoothPrinter,
  resetWebBluetoothSessionForTests,
  WEB_BLE_SERVICES,
} from "./webBluetoothPrinter";

function mockBluetooth(requestDevice: ReturnType<typeof vi.fn>, getDevices?: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("navigator", {
    bluetooth: {
      requestDevice,
      getDevices,
    },
  });
}

function printerDevice(overrides: Record<string, unknown> = {}) {
  const writeValue = vi.fn(async () => undefined);
  const writeValueWithoutResponse = vi.fn(async (data: BufferSource) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    (writeValueWithoutResponse as { writes?: number[] }).writes = [
      ...((writeValueWithoutResponse as { writes?: number[] }).writes ?? []),
      ...Array.from(bytes),
    ];
  });
  const characteristic = {
    uuid: "0000ffe1-0000-1000-8000-00805f9b34fb",
    properties: { write: true, writeWithoutResponse: true },
    writeValue,
    writeValueWithoutResponse,
  };
  return {
    id: "dev-1",
    name: "Xprinter XP-58",
    gatt: {
      connect: async () => ({
        getPrimaryService: async () => ({
          getCharacteristic: async () => characteristic,
          getCharacteristics: async () => [characteristic],
        }),
        getPrimaryServices: async () => [
          {
            uuid: "0000ffe0-0000-1000-8000-00805f9b34fb",
            getCharacteristic: async () => characteristic,
            getCharacteristics: async () => [characteristic],
          },
        ],
      }),
      disconnect: () => undefined,
    },
    characteristic,
    ...overrides,
  };
}

describe("webBluetoothPrinter", () => {
  afterEach(() => {
    resetWebBluetoothSessionForTests();
    vi.unstubAllGlobals();
  });

  it("is unavailable without navigator.bluetooth", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestWebBluetoothPrinter()).resolves.toMatchObject({
      ok: false,
      code: "web_bluetooth_unavailable",
    });
  });

  it("requests known printer services instead of acceptAllDevices by default", async () => {
    const device = printerDevice();
    const requestDevice = vi.fn(async () => device);
    mockBluetooth(requestDevice);
    const result = await requestWebBluetoothPrinter();
    expect(result.ok).toBe(true);
    const opts = (requestDevice.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0] as {
      acceptAllDevices?: boolean;
      filters?: Array<Record<string, unknown>>;
      optionalServices: number[];
    };
    expect(opts.acceptAllDevices).toBeUndefined();
    expect(opts.optionalServices).toEqual([...WEB_BLE_SERVICES]);
    expect(opts.filters?.some((f) => f.namePrefix === "Mobile Printer")).toBe(true);
  });

  it("prints saved BLE bytes in order through chunked writes", async () => {
    const writes: number[] = [];
    const characteristic = {
      uuid: "0000ffe1-0000-1000-8000-00805f9b34fb",
      properties: { write: true, writeWithoutResponse: true },
      writeValue: async () => undefined,
      writeValueWithoutResponse: async (data: BufferSource) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
        writes.push(...Array.from(bytes));
      },
    };
    const device = {
      id: "saved-ble",
      name: "BLE Printer",
      gatt: {
        connect: async () => ({
          getPrimaryService: async () => ({
            getCharacteristic: async () => characteristic,
            getCharacteristics: async () => [characteristic],
          }),
          getPrimaryServices: async () => [
            {
              uuid: "0000ffe0-0000-1000-8000-00805f9b34fb",
              getCharacteristics: async () => [characteristic],
            },
          ],
        }),
        disconnect: () => undefined,
      },
    };
    mockBluetooth(vi.fn(), vi.fn(async () => [device]));
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await printEscPosWebBluetooth(bytes, "ble:saved-ble");
    expect(result).toEqual({ ok: true });
    expect(writes).toEqual([1, 2, 3, 4, 5]);
  });

  it("reuses the in-memory BLE session when getDevices is empty", async () => {
    const device = printerDevice({ id: "session-ble" });
    const requestDevice = vi.fn(async () => device);
    mockBluetooth(requestDevice, vi.fn(async () => []));
    const picked = await requestWebBluetoothPrinter();
    expect(picked.ok).toBe(true);
    const printed = await printEscPosWebBluetooth(new Uint8Array([9, 8]), "ble:session-ble");
    expect(printed).toEqual({ ok: true });
    expect(requestDevice).toHaveBeenCalledTimes(1);
  });

  it("reports no writable characteristic instead of fake success", async () => {
    mockBluetooth(
      vi.fn(async () => ({
        id: "speaker",
        name: "JBL",
        gatt: {
          connect: async () => ({
            getPrimaryService: async () => {
              throw new Error("no service");
            },
            getPrimaryServices: async () => [],
          }),
          disconnect: () => undefined,
        },
      })),
    );
    const result = await requestWebBluetoothPrinter();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_device");
      expect(result.error).toBe("This Bluetooth device does not expose a supported printer connection.");
    }
  });

  it("explains Classic SPP when Chrome's chooser finds no BLE device", async () => {
    const err = Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" });
    mockBluetooth(vi.fn(async () => {
      throw err;
    }));
    const result = await requestWebBluetoothPrinter();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("classic_browser_unsupported");
      expect(result.error).toContain(CLASSIC_CHROME_CHOOSER_ERROR);
    }
  });

  it("maps Web Bluetooth permission denial", async () => {
    const err = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    mockBluetooth(vi.fn(async () => {
      throw err;
    }));
    const result = await requestWebBluetoothPrinter();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("permission_denied");
      expect(result.error).toBe("Bluetooth permission is required.");
    }
  });
});
