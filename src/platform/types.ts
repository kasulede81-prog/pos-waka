/**
 * WAKA platform + capability boundary (Desktop Phase 2).
 *
 * Shared React code should ask what this runtime can do,
 * instead of scattering Capacitor / Electron / userAgent checks.
 *
 * Does not change POS business logic, auth, offline DB, or device identity.
 */

export type WakaPlatform = "web" | "mobile" | "desktop";

/**
 * Coarse capabilities for routing native vs shared behavior.
 * Values must reflect what is actually available — not “Electron ⇒ everything true”.
 */
export type WakaCapabilities = {
  /** Electron system print dialog via `window.wakaDesktop.print`. */
  nativePrinting: boolean;
  /** LAN ESC/POS bridge via `window.wakaDesktop.escPosNetwork` (Phase 4). */
  escPosNetwork: boolean;
  /** Dedicated native cash-drawer transport (not ESC/POS kick-over-printer alone). */
  cashDrawer: boolean;
  /** USB/HID keyboard-wedge barcode buffering in the renderer. */
  barcodeScannerHid: boolean;
  /** Camera + BarcodeDetector path when APIs exist. */
  barcodeScannerCamera: boolean;
  /** Electron printer/OS diagnostics via `window.wakaDesktop.getPrinterDiagnostics`. */
  desktopDiagnostics: boolean;
  /** Shared IndexedDB offline POS (all shells). */
  offlinePOS: boolean;
  /** Electron Remote Support native bridge (`window.wakaDesktop.remoteSupport`). */
  remoteSupportNative: boolean;
};

export type WakaCapabilityName = keyof WakaCapabilities;
