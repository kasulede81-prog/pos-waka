/** True only in the packaged / dev Windows Electron desktop app (not browser or Capacitor). */
export function isElectronDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return /Electron/i.test(navigator.userAgent);
}
