/**
 * Browser Web Bluetooth BLE/GATT transport.
 * Does not speak Bluetooth Classic / SPP / RFCOMM.
 *
 * Production discovery uses known printer services and name prefixes.
 * acceptAllDevices is a documented last-resort for BLE printers that advertise
 * neither those services nor a printer-like name. It still cannot find Classic SPP.
 *
 * After connect, only GATT services declared in optionalServices are visible
 * (Web Bluetooth security). Unknown services cannot be enumerated.
 */
import { bluetoothDeviceLooksLikePrinter } from "./bluetoothPrinterHeuristics";

export const WEB_BLE_SERVICES = [0xffe0, 0x18f0] as const;
export const WEB_BLE_CHARS = [0xffe1, 0x2af1] as const;
export const UNSUPPORTED_PRINTER_CONNECTION =
  "This Bluetooth device does not expose a supported printer connection.";
export const CLASSIC_CHROME_CHOOSER_ERROR =
  "This printer appears to use Bluetooth Classic. Mac Chrome cannot access Bluetooth Classic printers directly. Use the WAKA Android app or a supported local/network printer connection.";
export const CLASSIC_CHOOSER_HINT =
  "If your printer is a Bluetooth Classic/SPP model, it will not appear in Chrome's Bluetooth chooser.";

const WEB_BLE_CHUNK = 20;

type GattCharacteristic = {
  uuid: string;
  properties?: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
};

type GattService = {
  uuid: string;
  getCharacteristic: (char: number | string) => Promise<GattCharacteristic>;
  getCharacteristics?: () => Promise<GattCharacteristic[]>;
};

type GattServer = {
  connected?: boolean;
  getPrimaryService: (service: number | string) => Promise<GattService>;
  getPrimaryServices?: () => Promise<GattService[]>;
};

type BluetoothRemoteDevice = {
  id: string;
  name?: string | null;
  gatt?: {
    connect: () => Promise<GattServer>;
    disconnect: () => void;
    connected?: boolean;
  };
};

type BluetoothApi = {
  requestDevice: (opts: Record<string, unknown>) => Promise<BluetoothRemoteDevice>;
  getDevices?: () => Promise<BluetoothRemoteDevice[]>;
};

export type WebBleDiagnostics = {
  name: string;
  connected: boolean;
  services: string[];
  writableCharacteristic: string | null;
  writeType: "write" | "write-without-response" | null;
};

export type WebBluetoothPrinterDevice = {
  id: string;
  name: string;
  transport: "ble";
  bonded: boolean;
  likelyPrinter: boolean;
  fromPairedList?: boolean;
  diagnostics?: WebBleDiagnostics;
};

let lastWebBleDevice: BluetoothRemoteDevice | null = null;
let lastChooserUsedAcceptAll = false;

function bluetoothApi(): BluetoothApi | null {
  if (typeof navigator === "undefined" || !("bluetooth" in navigator)) return null;
  return navigator.bluetooth as BluetoothApi;
}

export function isWebBluetoothAvailable(): boolean {
  return bluetoothApi() != null;
}

export function resetWebBluetoothSessionForTests(): void {
  lastWebBleDevice = null;
  lastChooserUsedAcceptAll = false;
}

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replace(/-/g, "");
}

function isPreferredChar(uuid: string): boolean {
  const n = normalizeUuid(uuid);
  return n.includes("ffe1") || n.includes("2af1") || n.includes("ff01");
}

function isWritable(char: GattCharacteristic): boolean {
  if (!char.properties) return false;
  return Boolean(char.properties.write || char.properties.writeWithoutResponse);
}

function writeTypeOf(char: GattCharacteristic): WebBleDiagnostics["writeType"] {
  if (char.properties?.writeWithoutResponse) return "write-without-response";
  if (char.properties?.write) return "write";
  return null;
}

type GattPick = {
  characteristic: GattCharacteristic | null;
  services: string[];
};

async function enumerateGatt(server: GattServer): Promise<GattPick> {
  const services: string[] = [];
  let preferred: GattCharacteristic | null = null;
  let fallback: GattCharacteristic | null = null;

  for (let i = 0; i < WEB_BLE_SERVICES.length; i++) {
    try {
      const service = await server.getPrimaryService(WEB_BLE_SERVICES[i]);
      services.push(`0x${WEB_BLE_SERVICES[i].toString(16)}`);
      const char = await service.getCharacteristic(WEB_BLE_CHARS[i] ?? WEB_BLE_CHARS[0]);
      if (char && isWritable(char) && !preferred) preferred = char;
    } catch {
      /* not present or not permitted */
    }
  }

  if (typeof server.getPrimaryServices === "function") {
    try {
      const listed = await server.getPrimaryServices();
      for (const service of listed) {
        if (service.uuid && !services.includes(service.uuid)) services.push(service.uuid);
        if (typeof service.getCharacteristics !== "function") continue;
        const chars = await service.getCharacteristics();
        for (const char of chars) {
          if (!isWritable(char)) continue;
          if (isPreferredChar(char.uuid) && !preferred) preferred = char;
          if (!fallback) fallback = char;
        }
      }
    } catch {
      /* stay with known-service probe */
    }
  }

  return { characteristic: preferred ?? fallback, services };
}

function logDiagnostics(diagnostics: WebBleDiagnostics): void {
  try {
    console.info("[waka-printer-ble]", {
      name: diagnostics.name,
      connected: diagnostics.connected,
      services: diagnostics.services,
      writableCharacteristic: diagnostics.writableCharacteristic,
      writeType: diagnostics.writeType,
    });
  } catch {
    /* ignore */
  }
}

async function writeChunked(char: GattCharacteristic, bytes: Uint8Array): Promise<void> {
  const write =
    char.properties?.writeWithoutResponse && char.writeValueWithoutResponse
      ? (slice: Uint8Array) => char.writeValueWithoutResponse!(slice as BufferSource)
      : (slice: Uint8Array) => char.writeValue(slice as BufferSource);
  for (let offset = 0; offset < bytes.length; offset += WEB_BLE_CHUNK) {
    const slice = bytes.subarray(offset, offset + WEB_BLE_CHUNK);
    await write(slice);
  }
}

function toRow(device: BluetoothRemoteDevice, diagnostics?: WebBleDiagnostics): WebBluetoothPrinterDevice {
  const name = device.name?.trim() || "Bluetooth device";
  return {
    id: `ble:${device.id}`,
    name,
    transport: "ble",
    bonded: true,
    likelyPrinter: bluetoothDeviceLooksLikePrinter(name),
    diagnostics,
  };
}

function chooserOptions(acceptAllBle?: boolean): Record<string, unknown> {
  if (acceptAllBle) {
    return {
      acceptAllDevices: true,
      optionalServices: [...WEB_BLE_SERVICES],
    };
  }
  return {
    filters: [
      { services: [WEB_BLE_SERVICES[0]] },
      { services: [WEB_BLE_SERVICES[1]] },
      { namePrefix: "Printer" },
      { namePrefix: "Mobile Printer" },
      { namePrefix: "MTP" },
      { namePrefix: "XP-" },
      { namePrefix: "RPP" },
      { namePrefix: "POS" },
      { namePrefix: "Thermal" },
    ],
    optionalServices: [...WEB_BLE_SERVICES],
  };
}

function mapChooserError(error: unknown): { ok: false; error: string; code: string } {
  const err = error as { name?: string; message?: string } | null;
  const name = err?.name ?? "";
  const message = err?.message ?? (error instanceof Error ? error.message : "");
  if (name === "SecurityError" || name === "NotAllowedError" || /permission|not allowed/i.test(message)) {
    return { ok: false, error: "Bluetooth permission is required.", code: "permission_denied" };
  }
  if (name === "NotFoundError" || /not found|no chooser|cancelled|canceled|no device/i.test(message)) {
    return {
      ok: false,
      error: `${CLASSIC_CHROME_CHOOSER_ERROR} ${CLASSIC_CHOOSER_HINT}`,
      code: "classic_browser_unsupported",
    };
  }
  return { ok: false, error: message || "Bluetooth thermal print failed.", code: "web_bluetooth_failed" };
}

async function inspectAndValidate(
  device: BluetoothRemoteDevice,
): Promise<{ ok: true; diagnostics: WebBleDiagnostics; characteristic: GattCharacteristic } | { ok: false; error: string; code: string; diagnostics: WebBleDiagnostics }> {
  const name = device.name?.trim() || "Bluetooth device";
  const empty: WebBleDiagnostics = {
    name,
    connected: false,
    services: [],
    writableCharacteristic: null,
    writeType: null,
  };
  const server = await device.gatt?.connect();
  if (!server) {
    return { ok: false, error: "Could not connect to Mobile Printer.", code: "connect_failed", diagnostics: empty };
  }
  const pick = await enumerateGatt(server);
  const diagnostics: WebBleDiagnostics = {
    name,
    connected: true,
    services: pick.services,
    writableCharacteristic: pick.characteristic?.uuid ?? null,
    writeType: pick.characteristic ? writeTypeOf(pick.characteristic) : null,
  };
  logDiagnostics(diagnostics);
  if (!pick.characteristic) {
    try {
      device.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    return { ok: false, error: UNSUPPORTED_PRINTER_CONNECTION, code: "unsupported_device", diagnostics };
  }
  return { ok: true, diagnostics, characteristic: pick.characteristic };
}

async function writeToDevice(
  device: BluetoothRemoteDevice,
  bytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  try {
    const inspected = await inspectAndValidate(device);
    if (!inspected.ok) return { ok: false, error: inspected.error, code: inspected.code };
    await writeChunked(inspected.characteristic, bytes);
    try {
      device.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    return { ok: true };
  } catch (error) {
    try {
      device.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    const message = error instanceof Error ? error.message : "Printer disconnected during transmission.";
    if (/gatt|disconnect/i.test(message)) {
      return { ok: false, error: "Printer disconnected during transmission.", code: "printer_disconnected" };
    }
    return { ok: false, error: message, code: "write_failed" };
  }
}

export async function requestWebBluetoothPrinter(opts?: {
  acceptAllBle?: boolean;
}): Promise<
  { ok: true; device: WebBluetoothPrinterDevice } | { ok: false; error: string; code?: string }
> {
  const api = bluetoothApi();
  if (!api) {
    return { ok: false, error: "Bluetooth printing is not available in this browser.", code: "web_bluetooth_unavailable" };
  }
  try {
    lastChooserUsedAcceptAll = Boolean(opts?.acceptAllBle);
    const device = await api.requestDevice(chooserOptions(opts?.acceptAllBle));
    lastWebBleDevice = device;
    const inspected = await inspectAndValidate(device);
    try {
      device.gatt?.disconnect();
    } catch {
      /* keep the device object for later writes */
    }
    if (!inspected.ok) {
      return { ok: false, error: inspected.error, code: inspected.code };
    }
    return { ok: true, device: toRow(device, inspected.diagnostics) };
  } catch (error) {
    return mapChooserError(error);
  }
}

async function resolveSavedDevice(deviceId: string): Promise<BluetoothRemoteDevice | null> {
  if (lastWebBleDevice && (`ble:${lastWebBleDevice.id}` === deviceId || lastWebBleDevice.id === deviceId)) {
    return lastWebBleDevice;
  }
  const api = bluetoothApi();
  if (!api?.getDevices) return null;
  const raw = deviceId.startsWith("ble:") ? deviceId.slice(4) : deviceId;
  const devices = await api.getDevices();
  return devices.find((d) => d.id === raw || `ble:${d.id}` === deviceId) ?? null;
}

export async function printEscPosWebBluetooth(
  bytes: Uint8Array,
  savedDeviceId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const api = bluetoothApi();
  if (!api) {
    return { ok: false, error: "Bluetooth printing is not available in this browser.", code: "web_bluetooth_unavailable" };
  }
  if (savedDeviceId?.trim()) {
    try {
      const saved = await resolveSavedDevice(savedDeviceId);
      if (saved) return writeToDevice(saved, bytes);
    } catch {
      /* chooser fallback */
    }
  }
  try {
    const device = await api.requestDevice(chooserOptions(lastChooserUsedAcceptAll));
    lastWebBleDevice = device;
    return writeToDevice(device, bytes);
  } catch (error) {
    return mapChooserError(error);
  }
}
