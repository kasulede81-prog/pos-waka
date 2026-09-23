/**
 * Open a Google Wallet Save URL without sending the public loyalty page as Referer.
 * Prefer a new tab with noopener,noreferrer; fall back to a same-document
 * navigation via <a rel="noreferrer"> (never window.location.assign).
 * Never logs the Save URL.
 */

export type OpenWalletSaveUrlResult = "opened_tab" | "same_tab_noreferrer" | "failed";

export function openWalletSaveUrlWithoutReferrer(
  saveUrl: string,
  deps: {
    open?: (url: string, target?: string, features?: string) => Window | null;
    createAnchor?: () => HTMLAnchorElement;
    append?: (el: HTMLAnchorElement) => void;
    remove?: (el: HTMLAnchorElement) => void;
  } = {},
): OpenWalletSaveUrlResult {
  const url = saveUrl.trim();
  if (!url) return "failed";

  const openFn =
    deps.open ??
    ((href: string, target?: string, features?: string) => {
      if (typeof window === "undefined") return null;
      return window.open(href, target, features);
    });

  const win = openFn(url, "_blank", "noopener,noreferrer");
  if (win != null) return "opened_tab";

  // Popup blocked — same-tab navigation without Referer.
  try {
    const a =
      deps.createAnchor?.() ??
      (typeof document !== "undefined" ? document.createElement("a") : null);
    if (!a) return "failed";
    a.href = url;
    a.rel = "noreferrer noopener";
    a.target = "_self";
    if (deps.append) deps.append(a);
    else if (typeof document !== "undefined") document.body.appendChild(a);
    a.click();
    if (deps.remove) deps.remove(a);
    else a.remove();
    return "same_tab_noreferrer";
  } catch {
    return "failed";
  }
}
