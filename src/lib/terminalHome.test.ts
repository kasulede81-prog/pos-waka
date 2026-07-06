import { describe, expect, it } from "vitest";
import { resolveTerminalHomePath } from "./terminalHome";

describe("resolveTerminalHomePath", () => {
  it("routes pharmacy mode to /pharmacy", () => {
    expect(
      resolveTerminalHomePath({ businessType: "pharmacy", pharmacyModeEnabled: true, hospitalityModeEnabled: true }, "owner"),
    ).toBe("/pharmacy");
  });

  it("routes hospitality floor staff to /floor", () => {
    expect(
      resolveTerminalHomePath({ businessType: "restaurant", pharmacyModeEnabled: false, hospitalityModeEnabled: true }, "owner"),
    ).toBe("/floor");
  });

  it("routes retail to /", () => {
    expect(
      resolveTerminalHomePath({ businessType: "kiosk_duka", pharmacyModeEnabled: false, hospitalityModeEnabled: false }, "owner"),
    ).toBe("/");
  });
});
