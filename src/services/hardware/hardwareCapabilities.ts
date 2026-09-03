import { Capacitor } from "@capacitor/core";
import { detectPrinterCapabilities } from "./printerAdapter";
import { detectBarcodeCapabilities } from "./barcodeAdapter";
import { getHardwareTransportCapabilities, type HardwareTransportCapabilities } from "./hardwareTransport";

export type HardwareCapabilitySnapshot = {
  platform: string;
  native: boolean;
  camera: boolean;
  bluetooth: boolean;
  usbPrinting: boolean;
  barcodeCamera: boolean;
  barcodeWedge: boolean;
  escPos: boolean;
  transports: HardwareTransportCapabilities;
};

export async function getHardwareCapabilitySnapshot(): Promise<HardwareCapabilitySnapshot> {
  const native = Capacitor.isNativePlatform();
  const printer = await detectPrinterCapabilities();
  const barcode = detectBarcodeCapabilities();
  const transports = await getHardwareTransportCapabilities();
  return {
    platform: Capacitor.getPlatform(),
    native,
    camera: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    bluetooth: printer.bluetoothAvailable,
    usbPrinting: printer.usbAvailable,
    barcodeCamera: barcode.cameraScan,
    barcodeWedge: barcode.hidWedge,
    escPos: printer.escPosAvailable,
    transports,
  };
}
