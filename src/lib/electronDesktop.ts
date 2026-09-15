import type { WakaDesktopRemoteSupportApi } from "./remoteSupport/nativeBoundary";

declare global {
  interface Window {
    wakaDesktop?: {
      platform?: string;
      print?: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; error?: string }>;
      getPrinterDiagnostics?: () => Promise<unknown>;
      escPosNetwork?: (opts: {
        host: string;
        port: number;
        data: number[];
      }) => Promise<{ ok: boolean; error?: string }>;
      remoteSupport?: WakaDesktopRemoteSupportApi;
    };
  }
}

/** True only in the packaged / dev Windows Electron desktop app (not browser or Capacitor). */
export function isElectronDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return /Electron/i.test(navigator.userAgent);
}
