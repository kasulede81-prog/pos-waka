/**
 * ANDROID-UPDATE-P1 — Play Store listing fallback.
 *
 * Used ONLY when the Play In-App Update flow (Play Core) cannot start:
 * missing/blocked Play Core, `flexible_not_allowed` / `immediate_not_allowed`,
 * `no_activity`, or a rejected `startUpdateFlow`.
 *
 * The listing itself is never a substitute for a successful in-app flow — it is
 * the honest recovery path so the user still has a way to update.
 */

/** Must match `applicationId` in android/app/build.gradle and `appId` in capacitor.config.ts. */
export const PLAY_APPLICATION_ID = "ug.waka.pos";

/** Resolved by the Play Store app itself (Capacitor WebView dispatches an ACTION_VIEW intent). */
export const PLAY_MARKET_URL = `market://details?id=${PLAY_APPLICATION_ID}`;

/** Browser-resolvable listing — works when the Play Store app cannot handle market://. */
export const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_APPLICATION_ID}`;

export type PlayStoreFallbackVia = "market" | "web" | "none";

export type PlayStoreFallbackResult = {
  opened: boolean;
  via: PlayStoreFallbackVia;
  error: string | null;
};

export type PlayStoreOpeners = {
  /** Android only — hands `market://` to the platform. */
  openMarket: (url: string) => void | Promise<void>;
  /** Any platform — opens the https listing. */
  openWeb: (url: string) => void | Promise<void>;
};

/**
 * Pure, injectable core so the fallback ladder is unit-testable without a device.
 * Ladder: market:// (Android) -> https listing -> report failure (never throws).
 */
export async function openPlayStoreListingWith(
  openers: PlayStoreOpeners,
  options: { isAndroid: boolean },
): Promise<PlayStoreFallbackResult> {
  let lastError: string | null = null;

  if (options.isAndroid) {
    try {
      await openers.openMarket(PLAY_MARKET_URL);
      return { opened: true, via: "market", error: null };
    } catch (err) {
      lastError = (err as Error)?.message ?? "market_open_failed";
    }
  }

  try {
    await openers.openWeb(PLAY_WEB_URL);
    return { opened: true, via: "web", error: null };
  } catch (err) {
    lastError = (err as Error)?.message ?? "play_web_open_failed";
  }

  return { opened: false, via: "none", error: lastError ?? "play_store_unavailable" };
}

async function defaultOpenMarket(url: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("no_window");
  // Capacitor's WebView client turns a non-http(s) scheme into an ACTION_VIEW intent.
  window.location.assign(url);
}

async function defaultOpenWeb(url: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("no_window");
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  } catch {
    /* fall through to plain window.open */
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("popup_blocked");
}

/** Runtime entry point — Android tries market:// first, everything else goes straight to https. */
export async function openPlayStoreListing(options?: {
  isAndroid?: boolean;
  openers?: Partial<PlayStoreOpeners>;
}): Promise<PlayStoreFallbackResult> {
  const isAndroid = options?.isAndroid ?? (await detectAndroidNative());
  return openPlayStoreListingWith(
    {
      openMarket: options?.openers?.openMarket ?? defaultOpenMarket,
      openWeb: options?.openers?.openWeb ?? defaultOpenWeb,
    },
    { isAndroid },
  );
}

async function detectAndroidNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}
