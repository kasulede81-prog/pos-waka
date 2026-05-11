import { Capacitor } from "@capacitor/core";
import { detectPrinterCapabilities } from "./printerAdapter";

export type HardwareCapabilitySnapshot = {
  platform: string;
  native: boolean;
  camera: boolean;
  bluetooth: boolean;
  usbPrinting: boolean;
};

export async function getHardwareCapabilitySnapshot(): Promise<HardwareCapabilitySnapshot> {
  const native = Capacitor.isNativePlatform();
  const printer = await detectPrinterCapabilities();
  return {
    platform: Capacitor.getPlatform(),
    native,
    camera: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    bluetooth: typeof navigator !== "undefined" && "bluetooth" in navigator,
    usbPrinting: printer.usbAvailable,
  };
}
