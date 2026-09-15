/** Barcode scanner / label bridge — camera, HID keyboard wedge, desktop/browser. */
export type BarcodeScanMode = "camera" | "hid" | "sunmi";

export type BarcodeCapabilities = {
  cameraScan: boolean;
  hidWedge: boolean;
  platform: "web" | "android" | "ios" | "electron" | "unknown";
};

type BarcodeSessionOptions = {
  onScan: (code: string) => void;
  onError?: (message: string) => void;
  videoElement?: HTMLVideoElement | null;
};

type SessionStopper = () => Promise<void> | void;

let activeStopper: SessionStopper | null = null;

const WEDGE_IDLE_MS = 45;

function isDedicatedBarcodeField(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as HTMLElement;
  return el.dataset?.barcodeScan === "true";
}

/** Skip HID wedge buffering while typing in form fields (search, customer, discounts). */
export function shouldBufferHidWedgeKey(event: Pick<KeyboardEvent, "target">): boolean {
  if (isDedicatedBarcodeField(event.target)) return true;
  if (!event.target || typeof event.target !== "object") return true;
  const el = event.target as HTMLElement;
  if (typeof el.tagName !== "string") return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  if (el.isContentEditable) return false;
  return true;
}

function resolvePlatform(): BarcodeCapabilities["platform"] {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("electron")) return "electron";
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
  return "web";
}

function normalizeCode(raw: string): string | null {
  const code = raw.trim();
  return code.length >= 3 ? code : null;
}

export function detectBarcodeCapabilities(): BarcodeCapabilities {
  const cameraScan =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector === "function";
  return {
    cameraScan,
    hidWedge: typeof window !== "undefined",
    platform: resolvePlatform(),
  };
}

async function startHidWedgeSession(options: BarcodeSessionOptions): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "Keyboard scanner is unavailable in this runtime." };

  let buffer = "";
  let timer: number | null = null;

  const flush = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    const normalized = normalizeCode(buffer);
    buffer = "";
    if (normalized) options.onScan(normalized);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!shouldBufferHidWedgeKey(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter" || event.key === "Tab") {
      if (buffer.length > 0) {
        event.preventDefault();
        flush();
      }
      return;
    }
    if (event.key.length === 1) {
      buffer += event.key;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(flush, WEDGE_IDLE_MS);
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  activeStopper = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    if (timer != null) window.clearTimeout(timer);
    buffer = "";
  };
  return { ok: true };
}

async function startCameraSession(options: BarcodeSessionOptions): Promise<{ ok: boolean; error?: string }> {
  const caps = detectBarcodeCapabilities();
  if (!caps.cameraScan) {
    return { ok: false, error: "Camera barcode scanning is not supported on this device." };
  }
  if (!options.videoElement) {
    return { ok: false, error: "Camera barcode scanner needs a video element target." };
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });

  options.videoElement.srcObject = stream;
  options.videoElement.muted = true;
  options.videoElement.playsInline = true;
  await options.videoElement.play();

  const DetectorCtor = (window as unknown as Window & { BarcodeDetector: new (opts?: { formats?: string[] }) => {
    detect: (input: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
  } }).BarcodeDetector;
  const detector = new DetectorCtor({
    formats: ["ean_13", "ean_8", "upc_e", "upc_a", "code_128", "code_39", "itf", "qr_code"],
  });

  let rafId = 0;
  let lastScanAt = 0;
  const scanLoop = async () => {
    try {
      const results = await detector.detect(options.videoElement!);
      const first = results[0]?.rawValue ? normalizeCode(results[0].rawValue) : null;
      if (first) {
        const now = Date.now();
        if (now - lastScanAt > 900) {
          lastScanAt = now;
          options.onScan(first);
        }
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : "Camera scan failed.");
    } finally {
      rafId = window.setTimeout(() => void scanLoop(), 180) as unknown as number;
    }
  };
  void scanLoop();

  activeStopper = () => {
    if (rafId) window.clearTimeout(rafId);
    options.videoElement?.pause();
    options.videoElement && (options.videoElement.srcObject = null);
    for (const track of stream.getTracks()) track.stop();
  };
  return { ok: true };
}

export async function startBarcodeSession(
  mode: BarcodeScanMode,
  options: BarcodeSessionOptions,
): Promise<{ ok: boolean; error?: string }> {
  await stopBarcodeSession();
  try {
    if (mode === "hid") return await startHidWedgeSession(options);
    if (mode === "camera") return await startCameraSession(options);
    return { ok: false, error: "Sunmi scanner bridge is not available in this build." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start barcode scanner.";
    options.onError?.(message);
    return { ok: false, error: message };
  }
}

export async function stopBarcodeSession(): Promise<void> {
  const stopper = activeStopper;
  activeStopper = null;
  await stopper?.();
}
