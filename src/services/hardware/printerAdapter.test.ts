import { describe, expect, it, vi, afterEach } from "vitest";
import { detectPrinterCapabilities, sendEscPosBytes, testPrint } from "./printerAdapter";
import type { PrinterProfile } from "../../types";

describe("printerAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports no native capabilities in non-browser runtime", async () => {
    const caps = await detectPrinterCapabilities();
    expect(caps.usbAvailable).toBe(false);
    expect(caps.bluetoothAvailable).toBe(false);
    expect(caps.escPosAvailable).toBe(false);
    expect(["PARTIAL", "UNAVAILABLE"]).toContain(caps.state);
    expect(caps.sunmiBuiltIn).toBe(false);
  });

  it("returns graceful unsupported result when no printer interface exists", async () => {
    const result = await testPrint({
      width: "80mm",
      lines: ["WAKA POS", "test"],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.length).toBeGreaterThan(10);
  });

  it("does not treat WebUSB API presence as printer-ready", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
      usb: {},
    });
    vi.stubGlobal("window", {
      navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0" },
    });
    const caps = await detectPrinterCapabilities();
    expect(caps.transports.usb.webUsb.available).toBe(true);
    expect(caps.transports.usb.webUsb.supported).toBe(false);
    expect(caps.transports.usb.webUsb.transportReady).toBe(false);
    expect(caps.usbAvailable).toBe(false);
    const usb: PrinterProfile = {
      id: "usb",
      name: "USB",
      connectionType: "usb",
      paperWidth: "80mm",
      stationRoles: ["receipt"],
      isEnabled: true,
    };
    const sent = await sendEscPosBytes(usb, new Uint8Array([1]));
    expect(sent.ok).toBe(false);
    expect(sent.error).toBe("USB thermal printing is not supported in this browser yet.");
  });
});
