import { describe, expect, it } from "vitest";
import { getHardwareCapabilitySnapshot } from "./hardwareCapabilities";

describe("hardware capability snapshot", () => {
  it("returns a complete snapshot shape", async () => {
    const snapshot = await getHardwareCapabilitySnapshot();
    expect(typeof snapshot.platform).toBe("string");
    expect(typeof snapshot.native).toBe("boolean");
    expect(typeof snapshot.camera).toBe("boolean");
    expect(typeof snapshot.bluetooth).toBe("boolean");
    expect(typeof snapshot.usbPrinting).toBe("boolean");
    expect(typeof snapshot.barcodeCamera).toBe("boolean");
    expect(typeof snapshot.barcodeWedge).toBe("boolean");
    expect(typeof snapshot.escPos).toBe("boolean");
  });
});
