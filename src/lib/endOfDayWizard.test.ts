import { describe, expect, it } from "vitest";
import {
  EOD_WIZARD_STEPS,
  eodWizardCanLeaveCashStep,
  eodWizardNextStep,
  eodWizardPrevStep,
} from "./endOfDayWizard";

describe("endOfDayWizard", () => {
  it("walks steps linearly", () => {
    expect(EOD_WIZARD_STEPS[0]).toBe("start");
    expect(eodWizardNextStep("start")).toBe("health");
    expect(eodWizardNextStep("review")).toBeNull();
    expect(eodWizardPrevStep("health")).toBe("start");
    expect(eodWizardPrevStep("start")).toBeNull();
  });

  it("requires a cash count before leaving cash step", () => {
    expect(eodWizardCanLeaveCashStep("")).toBe(false);
    expect(eodWizardCanLeaveCashStep("250000")).toBe(true);
  });
});
