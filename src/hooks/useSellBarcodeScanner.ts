import { useCallback, useEffect, useRef, useState } from "react";
import type { Language, Product } from "../types";
import { findProductByBarcode } from "../lib/pharmacyMedicine";
import { t } from "../lib/i18n";
import {
  detectBarcodeCapabilities,
  startBarcodeSession,
  stopBarcodeSession,
} from "../services/hardware/barcodeAdapter";

type Options = {
  lang: Language;
  products: Product[];
  onProductScanned: (product: Product, code: string) => void;
  onNotFound?: (code: string) => void;
  setSearchQuery: (q: string) => void;
  /**
   * Loyalty membership codes (`WAKA-LOYALTY:<token>`) are claimed here before
   * any product lookup. Return true to consume the scan; product scanning is
   * otherwise completely unchanged.
   */
  onLoyaltyScanned?: (code: string) => boolean;
};

export function useSellBarcodeScanner({
  lang,
  products,
  onProductScanned,
  onNotFound,
  setSearchQuery,
  onLoyaltyScanned,
}: Options) {
  const [cameraScanOpen, setCameraScanOpen] = useState(false);
  const [cameraScanStatus, setCameraScanStatus] = useState("");
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const caps = detectBarcodeCapabilities();

  const resolveBarcode = useCallback(
    (code: string) => {
      // A membership code is never a product. Claim it before the catalog
      // lookup so it cannot land in the search box or be reported "not found".
      if (onLoyaltyScanned?.(code)) return true;
      setSearchQuery(code);
      const exact = findProductByBarcode(products, code);
      if (exact) {
        onProductScanned(exact, code);
        return true;
      }
      onNotFound?.(code);
      return false;
    },
    [onLoyaltyScanned, onNotFound, onProductScanned, products, setSearchQuery],
  );

  useEffect(() => {
    if (!caps.hidWedge) return;
    void startBarcodeSession("hid", {
      onScan: (code) => {
        resolveBarcode(code);
      },
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [caps.hidWedge, resolveBarcode]);

  useEffect(() => {
    if (!cameraScanOpen) return;
    setCameraScanStatus(t(lang, "posBarcodeStarting"));
    void startBarcodeSession("camera", {
      videoElement: cameraVideoRef.current,
      onScan: (code) => {
        setCameraScanStatus(t(lang, "posBarcodeScanned").replace("{code}", code));
        resolveBarcode(code);
        void stopBarcodeSession();
        setCameraScanOpen(false);
      },
      onError: (message) => setCameraScanStatus(message),
    }).then((result) => {
      if (!result.ok) setCameraScanStatus(result.error ?? t(lang, "posBarcodeSoon"));
    });
    return () => {
      void stopBarcodeSession();
    };
  }, [cameraScanOpen, lang, resolveBarcode]);

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
