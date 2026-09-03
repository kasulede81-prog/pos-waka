import { Capacitor, registerPlugin } from "@capacitor/core";
import { withTimeout } from "./promiseTimeout";
import { mapNativeBluetoothPrinterError } from "./bluetoothPrinterHeuristics";

export type NativeBluetoothTransport = "classic" | "ble";

export type NativeBluetoothDeviceRow = {
  id: string;
  name: string;
  transport: NativeBluetoothTransport;
  bonded: boolean;
  bondState?: string;
  majorClass?: string;
  likelyPrinter: boolean;
  fromPairedList?: boolean;
  addressHint?: string;
};

export type NativeBluetoothState = {
  apiLevel: number;
  supported: boolean;
  enabled: boolean;
  connectPermission: boolean;
  scanPermission: boolean;
  classicSupported: boolean;
  bleSupported: boolean;
  nativeTransport: boolean;
};

type NativePrintResult = {
  ok?: boolean;
  status?: string;
  transport?: string;
  bytesWritten?: number;
};

interface WakaBluetoothPrinterPlugin {
  getBluetoothState(): Promise<NativeBluetoothState>;
  requestPermissions(): Promise<NativeBluetoothState>;
  getPairedDevices(): Promise<{ devices: NativeBluetoothDeviceRow[] }>;
  scanDevices(opts?: { timeoutMs?: number }): Promise<{ devices: NativeBluetoothDeviceRow[] }>;
  stopScan(): Promise<{ stopped: boolean }>;
  connect(opts: { deviceId: string; mode?: NativeBluetoothTransport }): Promise<NativePrintResult>;
  disconnect(opts?: { deviceId?: string }): Promise<NativePrintResult>;
  printEscPos(opts: {
    deviceId: string;
    data: number[];
    mode?: NativeBluetoothTransport;
  }): Promise<NativePrintResult>;
  testPrint(opts: { deviceId: string; data?: number[]; mode?: NativeBluetoothTransport }): Promise<NativePrintResult>;
  connectionStatus(opts?: { deviceId?: string }): Promise<{ status: string; transport?: string }>;
  pairDevice(opts: { deviceId: string }): Promise<{ ok: boolean; bonded?: boolean; systemPairing?: boolean }>;
}

export const WakaBluetoothPrinter = registerPlugin<WakaBluetoothPrinterPlugin>("WakaBluetoothPrinter");

export function isNativeBluetoothPrinterPlatform(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export async function isNativeBluetoothPrinterAvailable(): Promise<boolean> {
  if (!isNativeBluetoothPrinterPlatform()) return false;
  try {
    const state = await WakaBluetoothPrinter.getBluetoothState();
    return Boolean(state.nativeTransport) && Boolean(state.supported);
  } catch {
    return false;
  }
}

export async function getNativeBluetoothState(): Promise<NativeBluetoothState | null> {
  if (!isNativeBluetoothPrinterPlatform()) return null;
  try {
    return await WakaBluetoothPrinter.getBluetoothState();
  } catch {
    return null;
  }
}

function asError(err: unknown): { code?: string; message?: string } {
  if (err && typeof err === "object") {
    const o = err as { code?: string; message?: string; errorMessage?: string };
    return { code: o.code, message: o.message ?? o.errorMessage };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

export async function requestNativeBluetoothPermissions(): Promise<NativeBluetoothState | null> {
  if (!isNativeBluetoothPrinterPlatform()) return null;
  try {
    return await WakaBluetoothPrinter.requestPermissions();
  } catch (err) {
    throw new Error(mapNativeBluetoothPrinterError(asError(err).code, asError(err).message));
  }
}

export async function listPairedBluetoothPrinterDevices(): Promise<NativeBluetoothDeviceRow[]> {
  const r = await WakaBluetoothPrinter.getPairedDevices();
  return Array.isArray(r.devices) ? r.devices : [];
}

export async function scanBluetoothPrinterDevices(timeoutMs = 12000): Promise<NativeBluetoothDeviceRow[]> {
  const r = await WakaBluetoothPrinter.scanDevices({ timeoutMs });
  return Array.isArray(r.devices) ? r.devices : [];
}

export async function stopBluetoothPrinterScan(): Promise<void> {
  try {
    await WakaBluetoothPrinter.stopScan();
  } catch {
    /* ignore */
  }
}

export async function connectNativeBluetoothPrinter(
  deviceId: string,
  mode?: NativeBluetoothTransport,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  try {
    await WakaBluetoothPrinter.connect({ deviceId, mode });
    return { ok: true };
  } catch (err) {
    const e = asError(err);
    return { ok: false, error: mapNativeBluetoothPrinterError(e.code, e.message), code: e.code };
  }
}

export async function pairNativeBluetoothPrinter(
  deviceId: string,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  try {
    await WakaBluetoothPrinter.pairDevice({ deviceId });
    return { ok: true };
  } catch (err) {
    const e = asError(err);
    return { ok: false, error: mapNativeBluetoothPrinterError(e.code, e.message), code: e.code };
  }
}

export async function disconnectNativeBluetoothPrinter(deviceId?: string): Promise<void> {
  try {
    await WakaBluetoothPrinter.disconnect(deviceId ? { deviceId } : {});
  } catch {
    /* ignore */
  }
}

export async function printEscPosNative(
  deviceId: string,
  bytes: Uint8Array,
  mode?: NativeBluetoothTransport,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  try {
    const result = await withTimeout(
      WakaBluetoothPrinter.printEscPos({
        deviceId,
        data: Array.from(bytes),
        mode,
      }),
      12_000,
      null,
    );
    if (!result) {
      return { ok: false, error: "Printer did not respond. Check that it is on and in range." };
    }
    if (result.ok === false) {
      return { ok: false, error: "Could not connect to Mobile Printer." };
    }
    return { ok: true };
  } catch (err) {
    const e = asError(err);
    return { ok: false, error: mapNativeBluetoothPrinterError(e.code, e.message), code: e.code };
  }
}
