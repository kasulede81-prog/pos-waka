/**
 * Client-only Google Wallet Save URL delivery helpers (Phase 2).
 *
 * The Save URL is a bearer capability — these helpers never log it.
 * Generation still happens via `issueGoogleWalletPass` / edge function.
 */

export const WALLET_CARD_SHARE_INTRO =
  "Here is your WAKA loyalty card. Open this link on your phone to add it to Google Wallet.";

/** Full message body for WhatsApp / SMS / Web Share text. */
export function buildWalletCardShareText(saveUrl: string): string {
  const url = saveUrl.trim();
  return `${WALLET_CARD_SHARE_INTRO}\n\n${url}`;
}

/** WhatsApp share deep link (merchant still confirms send in WhatsApp). */
export function buildWhatsAppShareHref(saveUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(buildWalletCardShareText(saveUrl))}`;
}

/**
 * SMS composer deep link. Uses `sms:?body=` which works on modern Android;
 * iOS generally accepts the same form for the body.
 */
export function buildSmsShareHref(saveUrl: string): string {
  return `sms:?body=${encodeURIComponent(buildWalletCardShareText(saveUrl))}`;
}

export function isWebShareAvailable(
  shareFn: typeof navigator.share | undefined = typeof navigator !== "undefined" ? navigator.share : undefined,
): boolean {
  return typeof shareFn === "function";
}

export type CopyLinkResult = "copied" | "failed";

export async function copyWalletLink(
  saveUrl: string,
  clipboard: Pick<Clipboard, "writeText"> | null = typeof navigator !== "undefined" ? navigator.clipboard : null,
): Promise<CopyLinkResult> {
  const url = saveUrl.trim();
  if (!url) return "failed";
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(url);
      return "copied";
    }
  } catch {
    /* fall through */
  }
  return "failed";
}

export type WebShareResult = "shared" | "cancelled" | "unavailable" | "failed";

/**
 * Web Share API. On failure/unavailable the caller should fall back to copy.
 * Never logs the Save URL.
 */
export async function shareWalletLinkViaWebShare(
  saveUrl: string,
  shareFn: typeof navigator.share | undefined = typeof navigator !== "undefined" ? navigator.share : undefined,
): Promise<WebShareResult> {
  const url = saveUrl.trim();
  if (!url) return "failed";
  if (typeof shareFn !== "function") return "unavailable";
  try {
    await shareFn.call(navigator, {
      title: "WAKA loyalty card",
      text: WALLET_CARD_SHARE_INTRO,
      url,
    });
    return "shared";
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
    if (name === "AbortError") return "cancelled";
    return "failed";
  }
}

/** Open Save URL in a new tab/window (secondary “on this device” action). */
export function openWalletLinkOnThisDevice(
  saveUrl: string,
  openFn: (url: string, target?: string, features?: string) => Window | null = (url, target, features) => {
    if (typeof window === "undefined") return null;
    return window.open(url, target, features);
  },
): boolean {
  const url = saveUrl.trim();
  if (!url) return false;
  const win = openFn(url, "_blank", "noopener,noreferrer");
  return win != null;
}
