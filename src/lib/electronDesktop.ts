import type { WakaDesktopRemoteSupportApi } from "./remoteSupport/nativeBoundary";

export type WakaDesktopEscPosArgs = {
  host: string;
  port: number;
  data: number[];
};

export type WakaDesktopPrinterTarget = {
  host: string;
  port?: number;
};

export type WakaDesktopPrinterResult = {
  ok: boolean;
  error?: string;
  message?: string;
  code?: string;
  status?: string;
};

export type WakaDesktopHardwarePrinterApi = {
  printEscPos: (opts: WakaDesktopEscPosArgs) => Promise<WakaDesktopPrinterResult>;
  testConnection: (opts: WakaDesktopPrinterTarget) => Promise<WakaDesktopPrinterResult>;
  getStatus: (opts: WakaDesktopPrinterTarget) => Promise<WakaDesktopPrinterResult>;
};

declare global {
  interface Window {
    wakaDesktop?: {
      platform?: string;
      print?: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; error?: string }>;
      getPrinterDiagnostics?: () => Promise<unknown>;
      /** Desktop shell recovery — reloads packaged UI; does not clear storage. */
      reloadApp?: () => Promise<{ ok: boolean; error?: string }>;
      /** Typed hardware bridge (Phase 4A+). */
      hardware?: {
        printer?: WakaDesktopHardwarePrinterApi;
      };
      /**
       * Compatibility alias for LAN ESC/POS print (same IPC as hardware.printer.printEscPos).
       * Prefer hardware.printer for new code.
       */
      escPosNetwork?: (opts: WakaDesktopEscPosArgs) => Promise<WakaDesktopPrinterResult>;
      remoteSupport?: WakaDesktopRemoteSupportApi;
    };
  }
}

/**
 * True only in the packaged / dev Windows Electron desktop app (not browser or Capacitor).
 * Prefer the preload bridge when present; fall back to the Electron userAgent marker.
 */
export function isElectronDesktop(): boolean {
  if (typeof window === "undefined") return false;
  if (window.wakaDesktop) return true;
  return /Electron/i.test(navigator.userAgent);
}

/** True when the native LAN ESC/POS bridge is present. */
export function hasEscPosNetworkBridge(): boolean {
  if (typeof window === "undefined") return false;
  const d = window.wakaDesktop;
  return (
    typeof d?.hardware?.printer?.printEscPos === "function" ||
    typeof d?.escPosNetwork === "function"
  );
}
