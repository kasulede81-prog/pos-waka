import { Capacitor, registerPlugin } from "@capacitor/core";
import { withTimeout } from "./promiseTimeout";
import {
  extractBluetoothAddress,
  mapNativeBluetoothPrinterError,
  parseBluetoothDeviceId,
} from "./bluetoothPrinterHeuristics";

const classicPrintTails = new Map<string, Promise<unknown>>();

function classicLockKey(deviceId: string): string {
  return extractBluetoothAddress(deviceId) || deviceId;
}

/** Per-MAC Classic serialization. Different printers may overlap. */
export async function withClassicPrintLock<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
  const key = classicLockKey(deviceId);
  const previous = classicPrintTails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  classicPrintTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (classicPrintTails.get(key) === tail) classicPrintTails.delete(key);
  }
}

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

export const CLASSIC_SPP_DIAGNOSTIC_BYTES = new Uint8Array([
  0x1b, 0x40, 0x57, 0x41, 0x4b, 0x41, 0x20, 0x54, 0x45, 0x53, 0x54, 0x0a, 0x0a,
]);

export type NativeClassicDiagnostic = {
  ok: boolean;
  stage?: string;
  transport?: string;
  deviceId?: string;
  deviceName?: string;
  address?: string;
  bytesRequested?: number;
  bytesWritten?: number;
  connectionSucceeded?: boolean;
  writeSucceeded?: boolean;
  flushSucceeded?: boolean;
  socketClosed?: boolean;
  errorType?: string;
  errorMessage?: string;
  error?: string;
  code?: string;
  status?: string;
};

type NativePrintResult = NativeClassicDiagnostic;

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

function asError(err: unknown): { code?: string; message?: string; diagnostic?: NativeClassicDiagnostic } {
  if (err && typeof err === "object") {
    const o = err as {
      code?: string;
      message?: string;
      errorMessage?: string;
      data?: Record<string, unknown>;
    };
    const data = o.data && typeof o.data === "object" ? o.data : undefined;
    const diagnostic = data ? diagnosticFromPlugin(data, o.code, o.message ?? o.errorMessage) : undefined;
    return {
      code: o.code ?? (typeof data?.code === "string" ? data.code : undefined),
      message: o.message ?? o.errorMessage ?? diagnostic?.errorMessage,
      diagnostic,
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

function diagnosticFromPlugin(
  data: Record<string, unknown>,
  code?: string,
  message?: string,
): NativeClassicDiagnostic {
  return {
    ok: data.ok === true,
    stage: typeof data.stage === "string" ? data.stage : undefined,
    transport: typeof data.transport === "string" ? data.transport : "classic",
    deviceId: typeof data.deviceId === "string" ? data.deviceId : undefined,
    deviceName: typeof data.deviceName === "string" ? data.deviceName : undefined,
    address: typeof data.address === "string" ? data.address : undefined,
    bytesRequested: typeof data.bytesRequested === "number" ? data.bytesRequested : undefined,
    bytesWritten: typeof data.bytesWritten === "number" ? data.bytesWritten : 0,
    connectionSucceeded: data.connectionSucceeded === true,
    writeSucceeded: data.writeSucceeded === true,
    flushSucceeded: data.flushSucceeded === true,
    socketClosed: data.socketClosed === true,
    errorType: typeof data.errorType === "string" ? data.errorType : undefined,
    errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : message,
    error: message,
    code: typeof data.code === "string" ? data.code : code,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}

export function formatClassicSppDiagnostic(d: NativeClassicDiagnostic): string {
  const lines = [
    "Bluetooth Classic SPP",
    "",
    `Device: ${d.deviceName || "Bluetooth device"}`,
    `Address: ${d.address || parseBluetoothDeviceId(d.deviceId)?.address || "—"}`,
    "Transport: Android Native RFCOMM/SPP",
    `Connection: ${d.connectionSucceeded ? "SUCCESS" : "FAILED"}`,
    `RFCOMM: ${d.connectionSucceeded ? "SUCCESS" : "FAILED"}`,
    `Bytes: ${d.bytesWritten ?? 0}`,
    `Write: ${d.writeSucceeded ? "SUCCESS" : "FAILED"}`,
    `Flush: ${d.flushSucceeded ? "SUCCESS" : "FAILED"}`,
    `Socket close: ${d.socketClosed ? "SUCCESS" : "FAILED"}`,
    "PHYSICAL PAPER: NOT VERIFIED",
  ];
  if (d.ok) lines.push("PRINT JOB SENT");
  if (!d.ok && (d.errorType || d.errorMessage || d.error)) {
    lines.push("");
    if (d.stage) lines.push(`Stage: ${d.stage}`);
    if (d.errorType) lines.push(d.errorType);
    if (d.errorMessage || d.error) lines.push(d.errorMessage || d.error || "");
  }
  return lines.join("\n");
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
): Promise<{ ok: true; diagnostic?: NativeClassicDiagnostic } | { ok: false; error: string; code?: string; diagnostic?: NativeClassicDiagnostic }> {
  try {
    const result = await WakaBluetoothPrinter.connect({ deviceId, mode });
    return { ok: true, diagnostic: result };
  } catch (err) {
    const e = asError(err);
    return {
      ok: false,
      error: mapNativeBluetoothPrinterError(e.code, e.message),
      code: e.code,
      diagnostic: e.diagnostic,
    };
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
): Promise<NativeClassicDiagnostic> {
  const transport = mode ?? parseBluetoothDeviceId(deviceId)?.transport ?? "classic";
  if (transport === "classic") {
    return withClassicPrintLock(deviceId, () => printEscPosNativeUnlocked(deviceId, bytes, "classic"));
  }
  return printEscPosNativeUnlocked(deviceId, bytes, mode);
}

function incompleteWrite(result: NativePrintResult): boolean {
  return (
    typeof result.bytesRequested === "number" &&
    typeof result.bytesWritten === "number" &&
    result.bytesWritten !== result.bytesRequested
  );
}

async function printEscPosNativeUnlocked(
  deviceId: string,
  bytes: Uint8Array,
  mode?: NativeBluetoothTransport,
): Promise<NativeClassicDiagnostic> {
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
      return {
        ok: false,
        error: "Printer did not respond. Check that it is on and in range.",
        code: "timeout",
        stage: "RFCOMM_CONNECT",
        transport: mode ?? parseBluetoothDeviceId(deviceId)?.transport ?? "classic",
        deviceId,
      };
    }
    if (result.ok === false || incompleteWrite(result)) {
      return {
        ...result,
        ok: false,
        stage: result.stage ?? (incompleteWrite(result) ? "WRITE" : undefined),
        error:
          result.errorMessage ||
          result.error ||
          (incompleteWrite(result)
            ? `WRITE failed: wrote ${result.bytesWritten} of ${result.bytesRequested}`
            : "RFCOMM connection failed"),
      };
    }
    return { ...result, ok: true };
  } catch (err) {
    const e = asError(err);
    return {
      ok: false,
      error: mapNativeBluetoothPrinterError(e.code, e.message),
      code: e.code,
      stage: e.diagnostic?.stage,
      transport: e.diagnostic?.transport ?? mode,
      deviceId: e.diagnostic?.deviceId ?? deviceId,
      deviceName: e.diagnostic?.deviceName,
      address: e.diagnostic?.address,
      bytesRequested: e.diagnostic?.bytesRequested,
      bytesWritten: e.diagnostic?.bytesWritten,
      connectionSucceeded: e.diagnostic?.connectionSucceeded,
      writeSucceeded: e.diagnostic?.writeSucceeded,
      flushSucceeded: e.diagnostic?.flushSucceeded,
      socketClosed: e.diagnostic?.socketClosed,
      errorType: e.diagnostic?.errorType,
      errorMessage: e.diagnostic?.errorMessage ?? e.message,
    };
  }
}

export async function printClassicSppDiagnostic(
  deviceId: string,
): Promise<NativeClassicDiagnostic> {
  return printEscPosNative(deviceId, CLASSIC_SPP_DIAGNOSTIC_BYTES, "classic");
}
