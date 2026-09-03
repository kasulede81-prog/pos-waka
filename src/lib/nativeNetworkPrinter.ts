import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeNetworkResult = {
  ok?: boolean;
  message?: string;
  status?: string;
};

interface WakaNetworkPrinterPlugin {
  getTransportState(): Promise<{ nativeTransport?: boolean }>;
  printEscPos(opts: { host: string; port?: number; data: number[] }): Promise<NativeNetworkResult>;
  testConnection(opts: { host: string; port?: number }): Promise<NativeNetworkResult>;
}

export const WakaNetworkPrinter = registerPlugin<WakaNetworkPrinterPlugin>("WakaNetworkPrinter");

export function isNativeNetworkPrinterPlatform(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export async function isNativeNetworkPrinterAvailable(): Promise<boolean> {
  if (!isNativeNetworkPrinterPlatform()) return false;
  try {
    const state = await WakaNetworkPrinter.getTransportState();
    return Boolean(state.nativeTransport);
  } catch {
    return false;
  }
}

export async function printEscPosNativeNetwork(
  host: string,
  port: number,
  bytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  try {
    const result = await WakaNetworkPrinter.printEscPos({
      host,
      port,
      data: Array.from(bytes),
    });
    if (result.ok === false) {
      return { ok: false, error: result.message ?? "Could not connect to printer" };
    }
    return { ok: true };
  } catch (err) {
    const o = err && typeof err === "object" ? (err as { code?: string; message?: string }) : {};
    return { ok: false, error: o.message?.trim() || "Could not connect to printer", code: o.code };
  }
}

export async function testNativeNetworkPrinter(
  host: string,
  port: number,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const result = await WakaNetworkPrinter.testConnection({ host, port });
    if (result.ok === false) {
      return { ok: false, error: result.message ?? "Could not connect to printer" };
    }
    return { ok: true, message: result.message ?? "Printer connected" };
  } catch (err) {
    const o = err && typeof err === "object" ? (err as { message?: string }) : {};
    return { ok: false, error: o.message?.trim() || "Could not connect to printer" };
  }
}
