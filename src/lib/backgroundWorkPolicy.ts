import { isInternalAdminAppPath } from "./internalAdminPreview";

export function getPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

/** Only internal admin blocks background cloud pull — POS routes stay live (Phase 24.1B). */
export function shouldPausePosBackgroundPull(pathname: string = getPathname()): boolean {
  return isInternalAdminAppPath(pathname);
}

/** Block push-only uploads (internal admin only). */
export function shouldPausePosBackgroundPush(pathname: string = getPathname()): boolean {
  return isInternalAdminAppPath(pathname);
}

/** @deprecated Prefer shouldPausePosBackgroundPull — pull pause, not push. */
export function shouldPausePosBackgroundWork(pathname: string = getPathname()): boolean {
  return shouldPausePosBackgroundPull(pathname);
}
