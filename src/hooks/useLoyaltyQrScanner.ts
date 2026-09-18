import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  detectBarcodeCapabilities,
  startBarcodeSession,
  stopBarcodeSession,
} from "../services/hardware/barcodeAdapter";

/**
 * Camera-based membership QR scanner (Phase 05). Reuses the shared barcode
 * adapter; delivers raw scanned strings to the caller, which attempts a
 * loyalty token lookup (product barcodes simply fail the lookup).
 */
export function useLoyaltyQrScanner({
  lang,
  onScan,
}: {
  lang: Language;
  onScan: (code: string) => void;
}) {
  const [cameraScanOpen, setCameraScanOpen] = useState(false);
  const [cameraScanStatus, setCameraScanStatus] = useState("");
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const caps = detectBarcodeCapabilities();
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!cameraScanOpen) return;
    setCameraScanStatus(t(lang, "posBarcodeStarting"));
    void startBarcodeSession("camera", {
      videoElement: cameraVideoRef.current,
      onScan: (code) => {
        setCameraScanStatus(t(lang, "posBarcodeScanned").replace("{code}", code));
        onScanRef.current(code);
      },
      onError: (message) => setCameraScanStatus(message),
    }).then((result) => {
      if (!result.ok) setCameraScanStatus(result.error ?? t(lang, "posBarcodeSoon"));
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [cameraScanOpen, lang]);

  const openCameraScan = useCallback(() => {
    if (caps.cameraScan) setCameraScanOpen(true);
  }, [caps.cameraScan]);

  const closeCameraScan = useCallback(() => {
    void stopBarcodeSession();
    setCameraScanOpen(false);
  }, []);

  return {
    caps,
    cameraScanOpen,
    cameraScanStatus,
    cameraVideoRef,
    openCameraScan,
    closeCameraScan,
  };
}
