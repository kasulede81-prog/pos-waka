import type { WakaCapabilities, WakaCapabilityName } from "./types";
import { getPlatform, hasWakaDesktopBridge } from "./detect";

function desktopBridge() {
  return typeof window !== "undefined" ? window.wakaDesktop : undefined;
}

/**
 * Resolve capabilities for the current runtime.
 *
 * Desktop: nativePrinting / desktopDiagnostics / remoteSupportNative only when
 * the corresponding preload APIs exist. escPosNetwork is true only when the
 * Phase 4A printer bridge is present. cashDrawer stays false until Phase 4B.
 */
export function getCapabilities(): WakaCapabilities {
  const platform = getPlatform();
  const bridge = desktopBridge();

  if (platform === "desktop") {
    const escPosNetwork =
      typeof bridge?.hardware?.printer?.printEscPos === "function" ||
      typeof bridge?.escPosNetwork === "function";
    return {
      nativePrinting: typeof bridge?.print === "function",
      escPosNetwork,
      cashDrawer: false,
      barcodeScannerHid: typeof window !== "undefined",
      barcodeScannerCamera: true,
      desktopDiagnostics: typeof bridge?.getPrinterDiagnostics === "function",
      offlinePOS: true,
      remoteSupportNative: Boolean(
        typeof bridge?.remoteSupport?.getStatus === "function" &&
          typeof bridge.remoteSupport.requestAuthorizationCheck === "function" &&
          typeof bridge.remoteSupport.startAuthorizedTransport === "function" &&
          typeof bridge.remoteSupport.stopTransport === "function" &&
          typeof bridge.remoteSupport.getTransportStatus === "function",
      ),
    };
  }

  if (platform === "mobile") {
    return {
      // Mobile uses Capacitor PDF share / web print paths — not Electron system print.
      nativePrinting: false,
      escPosNetwork: false,
      cashDrawer: false,
      // Soft keyboards are not HID wedges; camera is the primary mobile path.
      barcodeScannerHid: false,
      barcodeScannerCamera:
        typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
      desktopDiagnostics: false,
      offlinePOS: true,
      remoteSupportNative: false,
    };
  }

  // web
  return {
    nativePrinting: false,
    escPosNetwork: false,
    cashDrawer: false,
    barcodeScannerHid: typeof window !== "undefined",
    barcodeScannerCamera: true,
    desktopDiagnostics: false,
    offlinePOS: true,
    remoteSupportNative: false,
  };
}

export function hasCapability(name: WakaCapabilityName): boolean {
  return getCapabilities()[name] === true;
}

/** Convenience: desktop shell with the Electron print bridge. */
export function canNativePrint(): boolean {
  return hasCapability("nativePrinting");
}

/** Convenience: Remote Support native IPC is present (transport may still be off). */
export function canRemoteSupportNative(): boolean {
  return hasCapability("remoteSupportNative");
}

/** True only when LAN ESC/POS is actually bridged (Phase 4A+). */
export function canEscPosNetwork(): boolean {
  return hasCapability("escPosNetwork") && hasWakaDesktopBridge();
}
