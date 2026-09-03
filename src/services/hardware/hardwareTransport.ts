/**
 * Authoritative printer transport resolver.
 * Does not format receipts or own the print queue.
 */
import type { PrinterConnectionType, PrinterProfile } from "../../types";
import { Capacitor } from "@capacitor/core";
import { canEscPosNetwork } from "../../platform/capabilities";
import { getPlatform } from "../../platform/detect";
import { parseBluetoothDeviceId } from "../../lib/bluetoothPrinterHeuristics";
import {
  isNativeBluetoothPrinterAvailable,
} from "../../lib/nativeBluetoothPrinter";
import { isNativeNetworkPrinterAvailable } from "../../lib/nativeNetworkPrinter";
import { hasActiveWebBleSession } from "../../lib/webBluetoothPrinter";

export type HardwareEnvironment =
  | "android-native"
  | "ios-native"
  | "electron"
  | "android-browser"
  | "ios-safari"
  | "desktop-browser"
  | "unknown";

export type PrinterTransportKind =
  | "native-classic"
  | "native-ble"
  | "web-bluetooth"
  | "web-usb"
  | "electron-network"
  | "android-network";

export type TransportSlot = {
  /** WAKA has an implementation for this environment. */
  supported: boolean;
  /** The current runtime exposes the API (not the same as a working printer). */
  available: boolean;
  /** A real printer transport can send ESC/POS on this path. */
  transportReady: boolean;
  reason: string;
};

export type HardwareTransportCapabilities = {
  environment: HardwareEnvironment;
  bluetooth: {
    classic: TransportSlot;
    ble: TransportSlot;
    native: boolean;
    webBluetooth: boolean;
  };
  usb: {
    native: TransportSlot;
    webUsb: TransportSlot;
  };
  network: {
    electron: TransportSlot;
    androidNative: TransportSlot;
    browserDirect: TransportSlot;
  };
};

export const CLASSIC_IN_BROWSER_ERROR =
  "Bluetooth Classic printers cannot be accessed directly from this browser. Use the WAKA Android app.";

export const IOS_BLUETOOTH_ERROR =
  "Direct Bluetooth thermal printing is not available in this browser. For Bluetooth Classic printers, use WAKA Android.";

export const WEB_BLUETOOTH_UNAVAILABLE_ERROR = "Bluetooth printing is not available in this browser.";

export const NETWORK_NEEDS_BRIDGE_ERROR = "Network printing is not available in this environment.";

export const USB_NOT_SUPPORTED_ERROR = "USB thermal printing is not supported in this browser yet.";

export function detectHardwareEnvironment(): HardwareEnvironment {
  if (typeof window === "undefined") return "unknown";
  const shell = getPlatform();
  if (shell === "desktop") return "electron";
  if (shell === "mobile") {
    try {
      const native = Capacitor.getPlatform();
      if (native === "ios") return "ios-native";
      if (native === "android") return "android-native";
    } catch {
      /* fall through */
    }
    return "android-native";
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (/iphone|ipad|ipod/.test(ua)) return "ios-safari";
  if (ua.includes("android")) return "android-browser";
  return "desktop-browser";
}

export function hasWebBluetoothApi(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export function hasWebUsbApi(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

function slot(
  supported: boolean,
  available: boolean,
  reason: string,
  transportReady = false,
): TransportSlot {
  return { supported, available, transportReady, reason };
}

export async function getHardwareTransportCapabilities(): Promise<HardwareTransportCapabilities> {
  const environment = detectHardwareEnvironment();
  const webBluetooth = hasWebBluetoothApi();
  const webUsb = hasWebUsbApi();
  const nativeBt = await isNativeBluetoothPrinterAvailable();
  const electronNet = canEscPosNetwork();
  const androidNet = await isNativeNetworkPrinterAvailable();

  const bleWeb =
    webBluetooth &&
    !nativeBt &&
    environment !== "ios-safari" &&
    environment !== "ios-native" &&
    environment !== "electron";

  return {
    environment,
    bluetooth: {
      classic: nativeBt
        ? slot(true, true, "Android Classic SPP/RFCOMM transport ready.", true)
        : environment === "android-native"
          ? slot(true, false, "Android Classic transport is installed but Bluetooth is not ready.")
          : slot(false, false, CLASSIC_IN_BROWSER_ERROR),
      ble: nativeBt
        ? slot(true, true, "Android BLE GATT printer transport ready.", true)
        : bleWeb
          ? slot(
              true,
              true,
              "Web Bluetooth API is present in this browser. Compatible BLE printers only — not Classic SPP.",
              false,
            )
          : environment === "ios-safari" || environment === "ios-native"
            ? slot(false, false, IOS_BLUETOOTH_ERROR)
            : slot(false, false, WEB_BLUETOOTH_UNAVAILABLE_ERROR),
      native: nativeBt,
      webBluetooth: bleWeb,
    },
    usb: {
      native: slot(false, false, "Native USB thermal transport is not implemented."),
      webUsb: webUsb
        ? slot(false, true, USB_NOT_SUPPORTED_ERROR, false)
        : slot(false, false, USB_NOT_SUPPORTED_ERROR),
    },
    network: {
      electron: electronNet
        ? slot(true, true, "Desktop LAN ESC/POS bridge ready.", true)
        : slot(environment === "electron", false, "LAN ESC/POS needs the WAKA desktop app."),
      androidNative: androidNet
        ? slot(true, true, "Android LAN ESC/POS transport ready.", true)
        : slot(environment === "android-native", false, "Android LAN transport is not ready."),
      browserDirect: slot(false, false, NETWORK_NEEDS_BRIDGE_ERROR),
    },
  };
}

export function resolveBluetoothMode(profile: Pick<PrinterProfile, "pairedDeviceKey" | "bluetoothTransport">):
  | "classic"
  | "ble"
  | null {
  if (profile.bluetoothTransport === "classic" || profile.bluetoothTransport === "ble") {
    return profile.bluetoothTransport;
  }
  return parseBluetoothDeviceId(profile.pairedDeviceKey)?.transport ?? null;
}

export function selectPrinterTransport(
  profile: PrinterProfile,
  caps: HardwareTransportCapabilities,
): { ok: true; transport: PrinterTransportKind } | { ok: false; error: string; code: string } {
  if (profile.connectionType === "network") {
    if (caps.network.electron.available) return { ok: true, transport: "electron-network" };
    if (caps.network.androidNative.available) return { ok: true, transport: "android-network" };
    if (caps.environment === "ios-safari" || caps.environment === "ios-native") {
      return { ok: false, error: NETWORK_NEEDS_BRIDGE_ERROR, code: "network_needs_bridge" };
    }
    return { ok: false, error: NETWORK_NEEDS_BRIDGE_ERROR, code: "network_needs_bridge" };
  }

  if (profile.connectionType === "usb" || profile.connectionType === "builtin") {
    if (caps.usb.webUsb.transportReady) return { ok: true, transport: "web-usb" };
    return { ok: false, error: caps.usb.webUsb.reason, code: "usb_unavailable" };
  }

  if (profile.connectionType === "bluetooth") {
    const mode = resolveBluetoothMode(profile);
    if (mode === "classic") {
      if (caps.bluetooth.classic.available) return { ok: true, transport: "native-classic" };
      if (caps.environment === "ios-safari" || caps.environment === "ios-native") {
        return { ok: false, error: IOS_BLUETOOTH_ERROR, code: "ios_bluetooth_unsupported" };
      }
      return { ok: false, error: CLASSIC_IN_BROWSER_ERROR, code: "classic_browser_unsupported" };
    }
    if (mode === "ble") {
      if (caps.bluetooth.native) return { ok: true, transport: "native-ble" };
      if (caps.bluetooth.webBluetooth) return { ok: true, transport: "web-bluetooth" };
      if (caps.environment === "ios-safari" || caps.environment === "ios-native") {
        return { ok: false, error: IOS_BLUETOOTH_ERROR, code: "ios_bluetooth_unsupported" };
      }
      return { ok: false, error: WEB_BLUETOOTH_UNAVAILABLE_ERROR, code: "web_bluetooth_unavailable" };
    }
    if (!profile.pairedDeviceKey?.trim()) {
      return { ok: false, error: "Select a Bluetooth printer in Hardware settings.", code: "no_device" };
    }
    if (caps.bluetooth.native) return { ok: true, transport: "native-classic" };
    if (caps.bluetooth.webBluetooth) return { ok: true, transport: "web-bluetooth" };
    if (caps.environment === "ios-safari" || caps.environment === "ios-native") {
      return { ok: false, error: IOS_BLUETOOTH_ERROR, code: "ios_bluetooth_unsupported" };
    }
    return { ok: false, error: CLASSIC_IN_BROWSER_ERROR, code: "classic_browser_unsupported" };
  }

  if (caps.network.electron.available) return { ok: true, transport: "electron-network" };
  if (caps.network.androidNative.available) return { ok: true, transport: "android-network" };
  if (caps.usb.webUsb.transportReady) return { ok: true, transport: "web-usb" };
  if (caps.bluetooth.native) return { ok: true, transport: "native-classic" };
  if (caps.bluetooth.webBluetooth) return { ok: true, transport: "web-bluetooth" };
  return { ok: false, error: "No printer transport is available on this device.", code: "no_transport" };
}

/** True when ESC/POS can be sent without a browser chooser that freezes the POS. */
export function canDeliverEscPosWithoutChooser(
  profile: PrinterProfile,
  caps: HardwareTransportCapabilities,
): boolean {
  const selected = selectPrinterTransport(profile, caps);
  if (!selected.ok) return false;
  if (
    selected.transport === "native-classic" ||
    selected.transport === "native-ble" ||
    selected.transport === "electron-network" ||
    selected.transport === "android-network"
  ) {
    return true;
  }
  if (selected.transport === "web-bluetooth") {
    return hasActiveWebBleSession(profile.pairedDeviceKey);
  }
  return false;
}

/** Connection types the operator may add. USB/builtin are not offered until a real transport exists. */
export function addPrinterConnectionTypes(caps: HardwareTransportCapabilities): PrinterConnectionType[] {
  if (caps.environment === "electron") return ["network", "bluetooth"];
  return ["bluetooth", "network"];
}

/** First connection type shown on Add printer — never USB. */
export function defaultPrinterConnectionType(caps: HardwareTransportCapabilities): PrinterConnectionType {
  if (caps.bluetooth.native) return "bluetooth";
  if (caps.environment === "electron") return "network";
  if (caps.bluetooth.webBluetooth) return "bluetooth";
  if (caps.network.electron.transportReady || caps.network.androidNative.transportReady) return "network";
  return "bluetooth";
}

export function summarizeCapabilityState(caps: HardwareTransportCapabilities): {
  state: "SUPPORTED" | "PARTIAL" | "UNAVAILABLE";
  stateReason: string;
  escPosAvailable: boolean;
  bluetoothAvailable: boolean;
  usbAvailable: boolean;
  networkAvailable: boolean;
  nativeBluetoothPrinter: boolean;
  classicSppSupported: boolean;
  bleSupported: boolean;
} {
  const bluetoothAvailable = caps.bluetooth.classic.transportReady || caps.bluetooth.ble.transportReady;
  const usbAvailable = caps.usb.webUsb.transportReady;
  const networkAvailable = caps.network.electron.transportReady || caps.network.androidNative.transportReady;

  if (caps.bluetooth.native) {
    return {
      state: "SUPPORTED",
      stateReason: "Android Bluetooth printer transport ready (Classic SPP and BLE). Select a printer in Hardware.",
      escPosAvailable: true,
      bluetoothAvailable: true,
      usbAvailable,
      networkAvailable,
      nativeBluetoothPrinter: true,
      classicSppSupported: true,
      bleSupported: true,
    };
  }

  if (networkAvailable) {
    return {
      state: "SUPPORTED",
      stateReason: "LAN ESC/POS bridge ready. Configure a network printer in Hardware.",
      escPosAvailable: true,
      bluetoothAvailable,
      usbAvailable,
      networkAvailable,
      nativeBluetoothPrinter: false,
      classicSppSupported: false,
      bleSupported: caps.bluetooth.ble.available,
    };
  }

  if (caps.environment === "unknown") {
    return {
      state: "UNAVAILABLE",
      stateReason: "No browser runtime.",
      escPosAvailable: false,
      bluetoothAvailable: false,
      usbAvailable: false,
      networkAvailable: false,
      nativeBluetoothPrinter: false,
      classicSppSupported: false,
      bleSupported: false,
    };
  }

  if (caps.bluetooth.webBluetooth) {
    return {
      state: "PARTIAL",
      stateReason:
        "Web Bluetooth is BLE/GATT only and cannot talk to Classic SPP printers. Use a BLE printer, the Android app, or a LAN printer in the desktop app.",
      escPosAvailable: false,
      bluetoothAvailable,
      usbAvailable,
      networkAvailable,
      nativeBluetoothPrinter: false,
      classicSppSupported: false,
      bleSupported: true,
    };
  }

  if (caps.environment === "electron") {
    return {
      state: "PARTIAL",
      stateReason: "Use system print or LAN ESC/POS when configured. USB/BT needs WebUSB/Web Bluetooth.",
      escPosAvailable: true,
      bluetoothAvailable,
      usbAvailable,
      networkAvailable,
      nativeBluetoothPrinter: false,
      classicSppSupported: false,
      bleSupported: caps.bluetooth.ble.available,
    };
  }

  if (caps.environment === "ios-safari" || caps.environment === "ios-native") {
    return {
      state: "PARTIAL",
      stateReason: IOS_BLUETOOTH_ERROR,
      escPosAvailable: false,
      bluetoothAvailable: false,
      usbAvailable,
      networkAvailable,
      nativeBluetoothPrinter: false,
      classicSppSupported: false,
      bleSupported: false,
    };
  }

  return {
    state: "PARTIAL",
    stateReason: "Browser print to any printer or Save as PDF from the print dialog.",
    escPosAvailable: false,
    bluetoothAvailable: false,
    usbAvailable: false,
    networkAvailable: false,
    nativeBluetoothPrinter: false,
    classicSppSupported: false,
    bleSupported: false,
  };
}
