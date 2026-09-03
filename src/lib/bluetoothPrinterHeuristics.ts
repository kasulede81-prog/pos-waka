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

export function mapNativeBluetoothPrinterError(code: string | undefined, message: string | undefined): string {
  if (code === "classic_browser_unsupported") {
    return "This printer appears to use Bluetooth Classic. Mac Chrome cannot access Bluetooth Classic printers directly. Use the WAKA Android app or a supported local/network printer connection.";
  }
  if (code === "ios_bluetooth_unsupported") {
    return "Bluetooth Classic printers require the WAKA app or another supported local bridge on iPhone/iPad.";
  }
  if (code === "unsupported_device" || code === "ble_no_writable") {
    return "This Bluetooth device does not expose a supported printer connection.";
  }
  if (code === "spp_failed") return "SPP connection failed.";
  if (code === "printer_disconnected") return "Printer disconnected during transmission.";
  if (code === "web_bluetooth_unavailable") return "Bluetooth printing is not available in this browser.";
  if (code === "bluetooth_disabled") return "Bluetooth is disabled.";
  if (code === "permission_denied") return "Bluetooth permission is required.";
  if (code === "unsupported") return "Bluetooth is not supported on this device.";
  if (code === "no_device") return "Select a Bluetooth printer in Hardware settings.";
  if (message?.trim()) return message.trim();
  return "Could not connect to Mobile Printer.";
}
