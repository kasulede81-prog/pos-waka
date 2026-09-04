import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale, ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import {
  WAKA_ANDROID_PACKAGE,
  WAKA_PRINT_PROTOCOL,
  WAKA_PRINT_SCHEME,
  buildAndroidPrintIntentUrl,
  buildDesktopPrintProtocolUrl,
  canAttemptDesktopPrintHandoff,
  canAttemptWebPrintHandoff,
  executeAppPrintHandoff,
  isAndroidChromeBrowser,
  isValidSaleId,
  isValidWakaReturnUrl,
  isWindowsDesktopChromeOrEdge,
  parsePrintDeepLink,
  tryLaunchAndroidPrintHandoff,
  tryLaunchDesktopPrintHandoff,
} from "./webPrintHandoff";
import { normalizeAuthDeepLinkToAppPath } from "./nativeAuthDeepLink";

const SALE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";
const WINDOWS_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0";
const LINUX_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/128.0.0.0 Mobile Safari/537.36";

const printSaleReceipt = vi.fn();

vi.mock("./receiptDocuments", () => ({
  printSaleReceipt: (...args: unknown[]) => printSaleReceipt(...args),
}));

vi.mock("./receiptContextHelpers", () => ({
  buildSaleReceiptContext: (params: { sale: Sale }) => ({
    sale: params.sale,
    receiptNumber: "INV-000001",
    cashier: "Super Admin",
  }),
}));

function sale(id = SALE_ID): Sale {
  return {
    id,
    status: "completed",
    lines: [],
    subtotalUgx: 1100,
    totalUgx: 1100,
    cashPaidUgx: 1100,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-09-04T14:01:00.000Z",
    pendingSync: false,
    soldByUserId: SALE_ID,
  };
}

function owner(): SessionActor {
  return {
    userId: SALE_ID,
    role: "owner",
    displayName: "Super Admin",
    authUserId: SALE_ID,
    authRole: "owner",
  };
}

function cashier(): SessionActor {
  return {
    userId: "staff:john",
    role: "cashier",
    displayName: "John",
    authUserId: "bbbbbbbb-2222-4222-8222-222222222222",
    authRole: "cashier",
  };
}

const store = {
  _hydrated: true,
  sessionActor: owner() as SessionActor | null,
  sales: [sale()] as Sale[],
  archivedSales: [] as Sale[],
  products: [],
  customers: [],
  auditLogs: [],
  preferences: { posLocked: false, shopDisplayName: "Shop" } as ShopPreferences,
};

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => store,
    subscribe: (fn: (s: typeof store) => void) => {
      fn(store);
      return () => undefined;
    },
  },
}));

describe("webPrintHandoff protocol", () => {
  it("builds a v1 Intent URL with encoded saleId, wakapos scheme, and package", () => {
    const fallback = "https://pos.waka.ug/pos";
    const url = buildAndroidPrintIntentUrl({ saleId: SALE_ID, fallbackUrl: fallback });
    expect(url).toContain(`intent://print/${WAKA_PRINT_PROTOCOL}?saleId=${encodeURIComponent(SALE_ID)}`);
    expect(url).toContain(`scheme=${WAKA_PRINT_SCHEME}`);
    expect(url).toContain(`package=${WAKA_ANDROID_PACKAGE}`);
    expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent(fallback)}`);
    expect(url?.endsWith(";end")).toBe(true);
    expect(url).not.toContain("ESC");
    expect(url).not.toContain("UGX");
  });

  it("rejects an invalid saleId when building the Intent URL", () => {
    expect(isValidSaleId("")).toBe(false);
    expect(isValidSaleId("bad id")).toBe(false);
    expect(buildAndroidPrintIntentUrl({ saleId: "", fallbackUrl: "https://pos.waka.ug/" })).toBeNull();
  });

  it("parses wakapos://print/v1 and ignores auth / unknown versions", () => {
    expect(parsePrintDeepLink(`wakapos://print/v1?saleId=${SALE_ID}`)).toEqual({ saleId: SALE_ID });
    expect(parsePrintDeepLink("wakapos://callback?code=abc")).toBeNull();
    expect(parsePrintDeepLink(`wakapos://print/v2?saleId=${SALE_ID}`)).toBeNull();
    expect(parsePrintDeepLink("wakapos://print/v1?saleId=")).toBeNull();
    expect(parsePrintDeepLink("https://evil.example/print")).toBeNull();
    expect(parsePrintDeepLink("not-a-url")).toBeNull();
  });

  it("rejects unsafe or unknown return URLs", () => {
    expect(isValidWakaReturnUrl("https://pos.waka.ug/pos")).toBe(true);
    expect(isValidWakaReturnUrl("javascript:alert(1)")).toBe(false);
    expect(isValidWakaReturnUrl("data:text/html,hi")).toBe(false);
    expect(isValidWakaReturnUrl("file:///etc/passwd")).toBe(false);
    expect(isValidWakaReturnUrl("https://evil.example/")).toBe(false);
    expect(isValidWakaReturnUrl("http://pos.waka.ug/")).toBe(false);
    expect(isValidWakaReturnUrl("not a url")).toBe(false);
  });

  it("does not launch handoff from a non-Android browser", () => {
    expect(isAndroidChromeBrowser(DESKTOP_CHROME)).toBe(false);
    expect(isAndroidChromeBrowser(SAMSUNG)).toBe(false);
    expect(canAttemptWebPrintHandoff(DESKTOP_CHROME)).toBe(false);
    expect(canAttemptWebPrintHandoff(WINDOWS_CHROME)).toBe(false);
    expect(tryLaunchAndroidPrintHandoff(SALE_ID, DESKTOP_CHROME)).toBe(false);
    expect(tryLaunchAndroidPrintHandoff(SALE_ID, WINDOWS_CHROME)).toBe(false);
  });

  it("launches the Intent URL from Android Chrome", () => {
    const loc = { href: "https://pos.waka.ug/pos" };
    vi.stubGlobal("window", { location: loc });
    expect(isAndroidChromeBrowser(ANDROID_CHROME)).toBe(true);
    expect(tryLaunchAndroidPrintHandoff(SALE_ID, ANDROID_CHROME)).toBe(true);
    expect(loc.href).toContain("intent://print/v1");
    expect(loc.href).toContain(WAKA_ANDROID_PACKAGE);
    vi.unstubAllGlobals();
  });
});

describe("webPrintHandoff app execution", () => {
  beforeEach(() => {
    store._hydrated = true;
    store.sessionActor = owner();
    store.sales = [sale()];
    store.archivedSales = [];
    store.preferences.posLocked = false;
    printSaleReceipt.mockReset();
    printSaleReceipt.mockResolvedValue({ ok: true, mode: "thermal" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prints an existing visible sale through printSaleReceipt", async () => {
    const result = await executeAppPrintHandoff(SALE_ID);
    expect(result.ok).toBe(true);
    expect(printSaleReceipt).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing sale without printing", async () => {
    store.sales = [];
    const result = await executeAppPrintHandoff(SALE_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not available on this device/i);
    expect(printSaleReceipt).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated session", async () => {
    store.sessionActor = { userId: "unknown", role: "cashier" };
    const result = await executeAppPrintHandoff(SALE_ID);
    expect(result.ok).toBe(false);
    expect(printSaleReceipt).not.toHaveBeenCalled();
  });

  it("rejects a cashier printing another seller's sale", async () => {
    store.sessionActor = cashier();
    const result = await executeAppPrintHandoff(SALE_ID);
    expect(result.ok).toBe(false);
    expect(printSaleReceipt).not.toHaveBeenCalled();
  });
});

describe("desktop Windows print handoff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (typeof window !== "undefined" && "wakaDesktop" in window) {
      delete (window as Window & { wakaDesktop?: unknown }).wakaDesktop;
    }
  });

  it("builds wakapos://print/v1 with saleId only", () => {
    const url = buildDesktopPrintProtocolUrl(SALE_ID);
    expect(url).toBe(`${WAKA_PRINT_SCHEME}://print/${WAKA_PRINT_PROTOCOL}?saleId=${encodeURIComponent(SALE_ID)}`);
    expect(url).not.toMatch(/host=|port=|mac=|9100|ESC|1b40/i);
    expect(buildDesktopPrintProtocolUrl("")).toBeNull();
    expect(buildDesktopPrintProtocolUrl("bad id")).toBeNull();
    expect(buildDesktopPrintProtocolUrl("x".repeat(81))).toBeNull();
  });

  it("is eligible on Windows Chrome and Edge only", () => {
    expect(isWindowsDesktopChromeOrEdge(WINDOWS_CHROME, "Win32")).toBe(true);
    expect(isWindowsDesktopChromeOrEdge(WINDOWS_EDGE, "Win32")).toBe(true);
    expect(isWindowsDesktopChromeOrEdge(WINDOWS_FIREFOX, "Win32")).toBe(false);
    expect(isWindowsDesktopChromeOrEdge(DESKTOP_CHROME, "MacIntel")).toBe(false);
    expect(isWindowsDesktopChromeOrEdge(LINUX_CHROME, "Linux x86_64")).toBe(false);
    expect(isWindowsDesktopChromeOrEdge(ANDROID_CHROME, "Linux armv8l")).toBe(false);
  });

  it("does not use the desktop branch on Android, Electron, or non-Windows", () => {
    vi.stubGlobal("window", { location: { href: "https://pos.waka.ug/pos" } });
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, platform: "Win32" });
    expect(canAttemptDesktopPrintHandoff(ANDROID_CHROME, "Linux armv8l")).toBe(false);
    expect(canAttemptDesktopPrintHandoff(WINDOWS_FIREFOX, "Win32")).toBe(false);
    expect(canAttemptDesktopPrintHandoff(DESKTOP_CHROME, "MacIntel")).toBe(false);
    expect(canAttemptDesktopPrintHandoff(LINUX_CHROME, "Linux x86_64")).toBe(false);
    expect(canAttemptWebPrintHandoff(WINDOWS_CHROME)).toBe(false);
  });

  it("does not launch desktop handoff from Electron", () => {
    vi.stubGlobal("window", {
      wakaDesktop: { platform: "win32" },
      location: { href: "file:///app/index.html" },
    });
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, platform: "Win32" });
    expect(canAttemptDesktopPrintHandoff(WINDOWS_CHROME, "Win32")).toBe(false);
    expect(tryLaunchDesktopPrintHandoff(SALE_ID, WINDOWS_CHROME, "Win32")).toBe(false);
  });

  it("launches the custom scheme from Windows Chrome without navigating the tab", () => {
    const iframe = { setAttribute: vi.fn(), style: { display: "" }, src: "", remove: vi.fn() };
    const loc = { href: "https://pos.waka.ug/pos" };
    vi.stubGlobal("window", { location: loc, wakaDesktop: undefined, setTimeout: () => 1 });
    vi.stubGlobal("navigator", { userAgent: WINDOWS_CHROME, platform: "Win32" });
    vi.stubGlobal("document", {
      createElement: () => iframe,
      body: { appendChild: vi.fn() },
    });
    expect(tryLaunchDesktopPrintHandoff(SALE_ID, WINDOWS_CHROME, "Win32")).toBe(true);
    expect(tryLaunchDesktopPrintHandoff(SALE_ID, WINDOWS_EDGE, "Win32")).toBe(true);
    expect(iframe.src).toBe(`wakapos://print/v1?saleId=${encodeURIComponent(SALE_ID)}`);
    expect(loc.href).toBe("https://pos.waka.ug/pos");
  });

  it("does not launch Android Intent from Windows Chrome", () => {
    expect(tryLaunchAndroidPrintHandoff(SALE_ID, WINDOWS_CHROME)).toBe(false);
    expect(tryLaunchAndroidPrintHandoff(SALE_ID, WINDOWS_EDGE)).toBe(false);
  });
});

describe("auth isolation", () => {
  it("auth mapper does not treat print/v1 as an auth URL", () => {
    expect(normalizeAuthDeepLinkToAppPath(`wakapos://print/v1?saleId=${SALE_ID}`)).toBeNull();
    expect(normalizeAuthDeepLinkToAppPath("wakapos://callback?code=abc")).toBe("/auth/callback?code=abc");
  });
});
