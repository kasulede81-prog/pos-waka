import { isBackOfficePath } from "./backOfficePaths";

/** React Router (BrowserRouter) tracks stack index on history.state. */
export function historyCanGoBack(): boolean {
  const st = window.history.state as { idx?: number } | null;
  return typeof st?.idx === "number" && st.idx > 0;
}

/** Where to go when there is no in-app history to pop. */
export function getBackFallbackPath(pathname: string, opts?: { desktopTerminal?: boolean }): string {
  if (opts?.desktopTerminal) {
    if (pathname.startsWith("/settings/")) return "/settings";
    if (pathname === "/settings") return "/";
    if (pathname.startsWith("/owner/")) return "/owner";
    if (pathname === "/owner") return "/";
    return "/";
  }
  if (pathname.startsWith("/settings/")) return "/settings";
  if (pathname === "/settings") return "/office";
  if (pathname.startsWith("/owner/")) return "/owner";
  if (pathname === "/owner") return "/office";
  if (pathname.startsWith("/office/")) return "/office";
  if (isBackOfficePath(pathname) && pathname !== "/office") return "/office";
  return "/";
}
