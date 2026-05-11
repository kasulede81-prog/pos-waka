/** Barcode scanner / label bridge — Zebra, camera, HID wedge. */
export type BarcodeScanMode = "camera" | "hid" | "sunmi";

export async function startBarcodeSession(_mode: BarcodeScanMode): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Barcode adapter stub — wire native scanner plugin here." };
}

export async function stopBarcodeSession(): Promise<void> {}
