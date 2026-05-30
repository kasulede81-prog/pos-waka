import { isInternalAdminAppPath } from "./internalAdminPreview";

/** Pause POS cloud sync, queue flush, and presence while Waka staff use internal ops. */
export function shouldPausePosBackgroundWork(pathname: string = getPathname()): boolean {
  return isInternalAdminAppPath(pathname);
}

export function getPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}
