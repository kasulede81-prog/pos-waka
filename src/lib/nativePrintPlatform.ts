import { Capacitor } from "@capacitor/core";

export function isNativePrintPlatform(): boolean {
  return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
}
