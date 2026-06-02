import { describe, expect, it } from "vitest";
import { detectPrinterCapabilities, testPrint } from "./printerAdapter";

describe("printerAdapter", () => {
  it("reports no native capabilities in non-browser runtime", async () => {
    const caps = await detectPrinterCapabilities();
    expect(caps.usbAvailable).toBe(false);
    expect(caps.bluetoothAvailable).toBe(false);
    expect(caps.escPosAvailable).toBe(false);
  });

  it("returns graceful unsupported result when no printer interface exists", async () => {
    const result = await testPrint({
      width: "80mm",
      lines: ["WAKA POS", "test"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No native thermal printer interface|failed|connection/i);
  });
});
