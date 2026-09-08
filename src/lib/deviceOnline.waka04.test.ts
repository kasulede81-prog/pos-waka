/**
 * WAKA-04 — web/Electron reconnect must update `deviceOnline` and fire the
 * same events the sync / recovery paths already listen for.
 *
 * The default Node environment has no `window`. This file installs a minimal
 * EventTarget shim so the real `initDeviceOnlineTracking` can be executed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isNative: false,
  connected: true,
  listener: null as null | ((s: { connected: boolean }) => void),
  addListener: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => (native.isNative ? "android" : "web"),
  },
  SystemBars: { setStyle: vi.fn() },
  SystemBarsStyle: { Dark: "DARK" },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: () => native.getStatus(),
    addListener: (event: string, cb: (s: { connected: boolean }) => void) => native.addListener(event, cb),
  },
}));

vi.mock("./nativeSplash", () => ({
  prepareNativeSplash: vi.fn(),
  scheduleSplashMaxDuration: vi.fn(),
  scheduleSplashSafetyTimeout: vi.fn(),
}));

vi.mock("./nativeAuthDeepLink", () => ({
  registerNativeAuthDeepLinkHandler: vi.fn(),
}));

vi.mock("./webPrintHandoff", () => ({
  registerNativePrintDeepLinkHandler: vi.fn(),
}));

let onLine = false;
let addEventListener: ReturnType<typeof vi.fn>;

function installBrowserShim(initialOnline: boolean): void {
  onLine = initialOnline;
  const target = new EventTarget();
  addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    target.addEventListener(type, listener, opts);
  });
  const win = {
    addEventListener,
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: (event: Event) => target.dispatchEvent(event),
    innerWidth: 1280,
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "navigator", {
    value: { get onLine() { return onLine; } },
    configurable: true,
  });
}

async function loadTracking() {
  vi.resetModules();
  native.addListener.mockReset().mockImplementation(
    async (event: string, cb: (s: { connected: boolean }) => void) => {
      if (event === "networkStatusChange") native.listener = cb;
      return { remove: async () => undefined };
    },
  );
  native.getStatus.mockReset().mockImplementation(async () => ({ connected: native.connected }));
  native.listener = null;
  return import("./deviceOnline");
}

describe("WAKA-04 — web/Electron online tracking", () => {
  beforeEach(() => {
    native.isNative = false;
    native.connected = true;
    installBrowserShim(false);
  });

  it("detects an offline → online transition and updates getDeviceOnline()", async () => {
    const { getDeviceOnline, initDeviceOnlineTracking } = await loadTracking();
    await initDeviceOnlineTracking();
    expect(getDeviceOnline()).toBe(false);

    onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(getDeviceOnline()).toBe(true);
  });

  it("dispatches waka:network-online on the reconnect transition", async () => {
    const { initDeviceOnlineTracking } = await loadTracking();
    await initDeviceOnlineTracking();

    const seen: string[] = [];
    window.addEventListener("waka:network-online", () => seen.push("online"));
    window.addEventListener("waka:network-offline", () => seen.push("offline"));
    window.addEventListener("waka:network-status", (e) => {
      seen.push(`status:${String((e as CustomEvent<{ connected: boolean }>).detail.connected)}`);
    });

    onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual(["status:true", "online"]);
  });

  it("reconnect unblocks the getDeviceOnline() gate used by runPosPushFlush / runFlush", async () => {
    const { getDeviceOnline, initDeviceOnlineTracking } = await loadTracking();
    await initDeviceOnlineTracking();

    // Same first-line guard as runPosPushFlush / runFlush / canRunPosPushUpload.
    const wouldSkipFlush = () => !getDeviceOnline();
    expect(wouldSkipFlush()).toBe(true);

    onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(wouldSkipFlush()).toBe(false);
  });

  it("initCapacitorShell starts tracking on web instead of returning without it", async () => {
    const tracking = await loadTracking();
    const { initCapacitorShell } = await import("./capacitorInit");
    await initCapacitorShell();

    expect(tracking.getDeviceOnline()).toBe(false);
    onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(tracking.getDeviceOnline()).toBe(true);
  });

  it("does not register Capacitor Network on web", async () => {
    const { initDeviceOnlineTracking } = await loadTracking();
    await initDeviceOnlineTracking();
    expect(native.addListener).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});

describe("WAKA-04 — native tracking is unchanged", () => {
  beforeEach(() => {
    native.isNative = true;
    native.connected = true;
    installBrowserShim(true);
  });

  it("still uses Capacitor Network and does not attach window online/offline listeners", async () => {
    const { getDeviceOnline, initDeviceOnlineTracking } = await loadTracking();
    await initDeviceOnlineTracking();

    expect(native.getStatus).toHaveBeenCalledTimes(1);
    expect(native.addListener).toHaveBeenCalledWith("networkStatusChange", expect.any(Function));
    expect(addEventListener).not.toHaveBeenCalledWith("online", expect.any(Function));
    expect(addEventListener).not.toHaveBeenCalledWith("offline", expect.any(Function));
    expect(getDeviceOnline()).toBe(true);
  });

  it("still flips the flag and emits waka events from the Network listener", async () => {
    const { getDeviceOnline, initDeviceOnlineTracking } = await loadTracking();
    await initDeviceOnlineTracking();

    const seen: string[] = [];
    window.addEventListener("waka:network-online", () => seen.push("online"));
    window.addEventListener("waka:network-offline", () => seen.push("offline"));

    native.listener?.({ connected: false });
    expect(getDeviceOnline()).toBe(false);
    expect(seen).toEqual(["offline"]);

    native.listener?.({ connected: true });
    expect(getDeviceOnline()).toBe(true);
    expect(seen).toEqual(["offline", "online"]);
  });
});
