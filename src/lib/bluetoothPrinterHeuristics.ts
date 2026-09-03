/** Conservative name/class heuristics — never hide devices from the operator. */

const PRINTER_NAME_HINTS = [
  "printer",
  "thermal",
  "xprinter",
  "rongta",
  "munbyn",
  "goojprt",
  "zjiang",
  "cashino",
  "epson",
  "star",
  "sunmi",
  "mobile printer",
  "mtp",
  "pos-",
  "pos ",
];

export function bluetoothDeviceLooksLikePrinter(name: string | null | undefined, majorClass?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (n && PRINTER_NAME_HINTS.some((h) => n.includes(h))) return true;
  return majorClass === "imaging";
}

/** Matches Java BluetoothAdapter.checkBluetoothAddress. */
export function isBluetoothAddress(address: string | null | undefined): boolean {
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test((address ?? "").trim().toUpperCase());
}

/** Matches Java WakaBluetoothPrinterPlugin.extractBluetoothAddress. */
export function extractBluetoothAddress(deviceId: string | null | undefined): string {
  let raw = (deviceId ?? "").trim();
  if (raw.toLowerCase().startsWith("classic:")) raw = raw.slice(8);
  else if (raw.toLowerCase().startsWith("ble:")) raw = raw.slice(4);
  return raw.toUpperCase();
}

export function parseBluetoothDeviceId(deviceId: string | null | undefined): {
  transport: "classic" | "ble";
  address: string;
} | null {
  const raw = (deviceId ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith("classic:")) {
    const address = raw.slice("classic:".length).trim().toUpperCase();
    return address ? { transport: "classic", address } : null;
  }
  if (lower.startsWith("ble:")) {
    const address = raw.slice("ble:".length).trim().toUpperCase();
    return address ? { transport: "ble", address } : null;
  }
  const address = raw.toUpperCase();
  return address ? { transport: "classic", address } : null;
}

export function formatBluetoothDeviceId(transport: "classic" | "ble", address: string): string {
  return `${transport}:${address.trim().toUpperCase()}`;
}

export function partitionBluetoothDiscovery<T extends { id: string; fromPairedList?: boolean; bonded?: boolean }>(
  devices: T[],
): { paired: T[]; nearby: T[] } {
  const collapsed = preferClassicBluetoothRows(devices);
  const paired: T[] = [];
  const nearby: T[] = [];
  const pairedIds = new Set<string>();
  for (const d of collapsed) {
    if (d.fromPairedList || d.bonded) {
      paired.push(d);
      pairedIds.add(d.id);
    }
  }
  for (const d of collapsed) {
    if (!pairedIds.has(d.id)) nearby.push(d);
  }
  return { paired, nearby };
}

/** Same MAC as classic + ble → keep Classic so SPP printers are not offered as GATT. */
export function preferClassicBluetoothRows<T extends { id: string }>(devices: T[]): T[] {
  const byAddress = new Map<string, T[]>();
  for (const d of devices) {
    const parsed = parseBluetoothDeviceId(d.id);
    const key = parsed?.address ?? d.id;
    const list = byAddress.get(key) ?? [];
    list.push(d);
    byAddress.set(key, list);
  }
  const out: T[] = [];
  for (const group of byAddress.values()) {
    const classic = group.find((d) => parseBluetoothDeviceId(d.id)?.transport === "classic");
    if (classic) {
      out.push(classic);
      continue;
    }
    out.push(...group);
  }
  return out;
}

export function mapNativeBluetoothPrinterError(code: string | undefined, message: string | undefined): string {
  if (code === "classic_browser_unsupported") {
    return "Bluetooth Classic printers cannot be accessed directly from this browser. Use the WAKA Android app.";
  }
  if (code === "ios_bluetooth_unsupported") {
    return "Direct Bluetooth thermal printing is not available in this browser. For Bluetooth Classic printers, use WAKA Android.";
  }
  if (code === "unsupported_device" || code === "ble_no_writable") {
    return "This Bluetooth device does not expose a supported printer connection.";
  }
  if (code === "spp_failed") return "SPP connection failed.";
  if (code === "printer_disconnected") return "Printer disconnected during transmission.";
  if (code === "web_bluetooth_unavailable") return "Bluetooth printing is not available in this browser.";
  if (code === "bluetooth_disabled") return "Turn on Bluetooth to connect a printer.";
  if (code === "permission_denied") return "Bluetooth permission is required to find printers.";
  if (code === "unsupported") return "Bluetooth is not supported on this device.";
  if (code === "no_device" || code === "session_lost") return "Select your BLE printer again.";
  if (code === "chooser_cancelled") return "No compatible BLE device was selected.";
  if (code === "pairing_required") {
    return "Pair this printer in Android Bluetooth settings, then select it from Paired.";
  }
  if (code === "write_failed") {
    return message?.trim() || "RFCOMM write failed";
  }
  if (code === "classic_spp_failed" || code === "connect_failed") {
    return message?.trim() || "RFCOMM connection failed";
  }
  if (message?.trim()) return message.trim();
  return "Could not connect to Mobile Printer.";
}
