import { Capacitor } from "@capacitor/core";
import { detectPrinterCapabilities } from "./printerAdapter";
import { detectBarcodeCapabilities } from "./barcodeAdapter";

export type HardwareCapabilitySnapshot = {
  platform: string;
  native: boolean;
  camera: boolean;
  bluetooth: boolean;
  usbPrinting: boolean;
  barcodeCamera: boolean;
  barcodeWedge: boolean;
  escPos: boolean;
};

export async function getHardwareCapabilitySnapshot(): Promise<HardwareCapabilitySnapshot> {
  const native = Capacitor.isNativePlatform();
  const printer = await detectPrinterCapabilities();
  const barcode = detectBarcodeCapabilities();
  return {
    platform: Capacitor.getPlatform(),
    native,
    camera: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    bluetooth: typeof navigator !== "undefined" && "bluetooth" in navigator,
    usbPrinting: printer.usbAvailable,
    barcodeCamera: barcode.cameraScan,
    barcodeWedge: barcode.hidWedge,
    escPos: printer.escPosAvailable,
  };
}
