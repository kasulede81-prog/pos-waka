import { describe, expect, it } from "vitest";
import { detectBarcodeCapabilities, startBarcodeSession, stopBarcodeSession } from "./barcodeAdapter";

describe("barcodeAdapter", () => {
  it("reports safe defaults in non-browser runtime", () => {
    const caps = detectBarcodeCapabilities();
    expect(caps.hidWedge).toBe(false);
    expect(caps.cameraScan).toBe(false);
  });

  it("returns unsupported error for camera when runtime lacks support", async () => {
    const result = await startBarcodeSession("camera", {
      onScan: () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not supported|needs a video element|unavailable/i);
    await stopBarcodeSession();
  });

  it("returns unsupported error for hid when runtime lacks window", async () => {
    const result = await startBarcodeSession("hid", {
      onScan: () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unavailable/i);
  });
});
