import { describe, expect, it } from "vitest";
import { resolveTerminalHomePath } from "./terminalHome";

describe("resolveTerminalHomePath", () => {
  it("routes pharmacy mode to the shared launcher", () => {
    expect(
      resolveTerminalHomePath({ businessType: "pharmacy", pharmacyModeEnabled: true, hospitalityModeEnabled: true }, "owner"),
    ).toBe("/");
  });

  it("routes hospitality floor staff to /floor", () => {
    expect(
      resolveTerminalHomePath({ businessType: "restaurant", pharmacyModeEnabled: false, hospitalityModeEnabled: true }, "owner"),
    ).toBe("/floor");
  });

  it("routes kitchen-only staff to /kitchen (they hold no floor permission)", () => {
    expect(
      resolveTerminalHomePath({ businessType: "restaurant", pharmacyModeEnabled: false, hospitalityModeEnabled: true }, "kitchen"),
    ).toBe("/kitchen");
  });

  it("routes retail to /", () => {
    expect(
      resolveTerminalHomePath({ businessType: "kiosk_duka", pharmacyModeEnabled: false, hospitalityModeEnabled: false }, "owner"),
    ).toBe("/");
  });
});
