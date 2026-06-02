import { describe, expect, it } from "vitest";
import { detectPrinterCapabilities, testPrint } from "./printerAdapter";

describe("printerCapability", () => {
  it("reports capability state in vitest (no navigator APIs)", async () => {
    const caps = await detectPrinterCapabilities();
    expect(["PARTIAL", "UNAVAILABLE", "SUPPORTED"]).toContain(caps.state);
    expect(caps.sunmiBuiltIn).toBe(false);
    expect(caps.escPosAvailable).toBe(false);
    expect(caps.stateReason.length).toBeGreaterThan(5);
  });

  it("testPrint fails gracefully without hardware", async () => {
    const result = await testPrint({ width: "80mm", lines: ["Test"] });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
