import { useEffect, useRef, useState } from "react";
import { X, Camera } from "lucide-react";

// Minimal typing for the experimental BarcodeDetector API.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

export function isBarcodeSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;

    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Ctor) {
      setError("Your browser doesn't support camera barcode scanning. Try Chrome on Android.");
      return;
    }

    const detector = new Ctor({
      formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"],
    });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              onScan(codes[0].rawValue);
              return;
            }
          } catch {
            /* ignore per-frame errors */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setError((e as Error).message || "Camera permission denied.");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-3xl bg-background p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-black">
            <Camera className="h-4 w-4 text-waka-700" /> Scan barcode
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl bg-black aspect-[4/3] relative">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {!ready && !error && (
            <div className="absolute inset-0 grid place-items-center text-xs text-white/80">
              Starting camera…
            </div>
          )}
          {ready && (
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-waka-500/80" />
          )}
        </div>
        {error ? (
          <p className="mt-3 text-xs text-destructive">{error}</p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Point at the barcode. We'll match it to a product automatically.
          </p>
        )}
      </div>
    </div>
  );
}
