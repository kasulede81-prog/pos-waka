/**
 * Print-only handoff: Android Chrome → installed WAKA app (ug.waka.pos).
 * Does not format receipts, touch Bluetooth, or alter auth deep links.
 */

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { WAKA_POS_URL } from "../config/company";
import { isElectronDesktop } from "./electronDesktop";
import { authOperatorRole } from "./sessionActor";
import { filterSalesForHomeScope, resolveVisibleHomeMetrics } from "./homeVisibility";
import { readUiLanguageCacheSync } from "./uiLanguage";

export const WAKA_PRINT_SCHEME = "wakapos";
export const WAKA_ANDROID_PACKAGE = "ug.waka.pos";
export const WAKA_PRINT_HOST = "print";
export const WAKA_PRINT_PROTOCOL = "v1";

const SALE_ID_MAX = 80;
const HYDRATE_WAIT_MS = 4000;

export type PrintDeepLink = {
  saleId: string;
};

export function isValidSaleId(saleId: string | null | undefined): boolean {
  const id = saleId?.trim() ?? "";
  if (!id || id.length > SALE_ID_MAX) return false;
  if (/[\s#]/.test(id)) return false;
  return true;
}

/** Android Chrome in a normal browser tab — not Capacitor, Electron, or WebView. */
export function isAndroidChromeBrowser(userAgent?: string): boolean {
  if (typeof navigator === "undefined" && userAgent == null) return false;
  const ua = userAgent ?? navigator.userAgent ?? "";
  if (!/Android/i.test(ua)) return false;
  if (/; wv\)|WebView/i.test(ua)) return false;
  if (/SamsungBrowser|Firefox|EdgA|OPR|Opera/i.test(ua)) return false;
  return /Chrome/i.test(ua);
}

export function canAttemptWebPrintHandoff(userAgent?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return false;
  } catch {
    return false;
  }
  if (isElectronDesktop()) return false;
  return isAndroidChromeBrowser(userAgent);
}

export function isValidWakaReturnUrl(raw: string | null | undefined): boolean {
  const value = raw?.trim() ?? "";
  if (!value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const allowed = new URL(WAKA_POS_URL).hostname.toLowerCase();
  return parsed.hostname.toLowerCase() === allowed;
}

export function parsePrintDeepLink(url: string | null | undefined): PrintDeepLink | null {
  const raw = url?.trim() ?? "";
  if (!raw) return null;
  const prefix = `${WAKA_PRINT_SCHEME}://`;
  if (!raw.toLowerCase().startsWith(prefix)) return null;

  const rest = raw.slice(prefix.length);
  const q = rest.indexOf("?");
  const pathPart = (q >= 0 ? rest.slice(0, q) : rest).replace(/^\/+/, "").replace(/\/+$/, "");
  const qs = q >= 0 ? rest.slice(q + 1) : "";
  if (pathPart !== `${WAKA_PRINT_HOST}/${WAKA_PRINT_PROTOCOL}`) return null;

  const params = new URLSearchParams(qs);
  const saleId = params.get("saleId")?.trim() ?? "";
  if (!isValidSaleId(saleId)) return null;
  return { saleId };
}

export function buildAndroidPrintIntentUrl(opts: {
  saleId: string;
  fallbackUrl: string;
}): string | null {
  if (!isValidSaleId(opts.saleId)) return null;
  const fallback = opts.fallbackUrl?.trim() ?? "";
  if (!fallback) return null;
  const query = `saleId=${encodeURIComponent(opts.saleId.trim())}`;
  return `intent://${WAKA_PRINT_HOST}/${WAKA_PRINT_PROTOCOL}?${query}#Intent;scheme=${WAKA_PRINT_SCHEME};package=${WAKA_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

export function tryLaunchAndroidPrintHandoff(saleId: string, userAgent?: string): boolean {
  if (!canAttemptWebPrintHandoff(userAgent)) return false;
  if (typeof window === "undefined") return false;
  const intent = buildAndroidPrintIntentUrl({
    saleId,
    fallbackUrl: window.location.href,
  });
  if (!intent) return false;
  window.location.href = intent;
  return true;
}

function isSignedInActor(actor: { userId?: string } | null | undefined): boolean {
  const id = actor?.userId?.trim() ?? "";
  return Boolean(id) && id !== "unknown";
}

async function waitForLocalHydration(): Promise<boolean> {
  const { usePosStore } = await import("../store/usePosStore");
  if (usePosStore.getState()._hydrated) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(usePosStore.getState()._hydrated);
    }, HYDRATE_WAIT_MS);
    const unsub = usePosStore.subscribe((state) => {
      if (!state._hydrated) return;
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

export async function executeAppPrintHandoff(saleId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isValidSaleId(saleId)) {
    return { ok: false, error: "Invalid print request." };
  }

  const hydrated = await waitForLocalHydration();
  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  if (!hydrated && !state._hydrated) {
    return { ok: false, error: "This sale is not available on this device yet." };
  }

  const actor = state.sessionActor;
  if (!actor || !isSignedInActor(actor) || state.preferences.posLocked) {
    return { ok: false, error: "Sign in to WAKA on this device to print." };
  }

  const sale =
    state.sales.find((s) => s.id === saleId) ??
    (state.archivedSales ?? []).find((s) => s.id === saleId) ??
    null;
  if (!sale) {
    return { ok: false, error: "This sale is not available on this device yet." };
  }

  const scope = resolveVisibleHomeMetrics(authOperatorRole(actor)).scope;
  const visible = filterSalesForHomeScope([sale], scope, actor);
  if (!visible.length) {
    return { ok: false, error: "This sale is not available on this device yet." };
  }

  const { buildSaleReceiptContext } = await import("./receiptContextHelpers");
  const { printSaleReceipt } = await import("./receiptDocuments");
  const customer = sale.customerId ? state.customers.find((c) => c.id === sale.customerId) : null;
  const ctx = buildSaleReceiptContext({
    lang: readUiLanguageCacheSync() ?? "en",
    sale,
    allSales: state.sales,
    preferences: state.preferences,
    products: state.products,
    actor,
    customerName: sale.receiptCustomerName ?? customer?.name ?? null,
    customerPhone: sale.receiptCustomerPhone ?? customer?.phone ?? null,
    customerBalanceUgx: customer?.debtBalanceUgx ?? null,
    auditLogs: state.auditLogs,
  });
  const result = await printSaleReceipt(ctx);
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error ?? "Could not print to the receipt printer." };
}

let printHandlerRegistered = false;

export function registerNativePrintDeepLinkHandler(): void {
  if (!Capacitor.isNativePlatform() || printHandlerRegistered) return;
  printHandlerRegistered = true;

  const onUrl = (url: string) => {
    const parsed = parsePrintDeepLink(url);
    if (!parsed) return;
    void executeAppPrintHandoff(parsed.saleId).then((result) => {
      if (result.ok) return;
      if (typeof window !== "undefined" && result.error) {
        window.alert(result.error);
      }
    });
  };

  void App.addListener("appUrlOpen", ({ url }) => onUrl(url));
  void App.getLaunchUrl().then((result) => {
    if (result?.url) onUrl(result.url);
  });
}
