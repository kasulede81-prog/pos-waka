import { describe, expect, it } from "vitest";
import { receiptPrintActionLabel } from "./printActionLabels";

describe("print action labels", () => {
  it("shows Print on web", () => {
    expect(receiptPrintActionLabel("en")).toBe("Print");
  });

  it("shows Print on native", () => {
    expect(receiptPrintActionLabel("en")).toBe("Print");
  });

  it("uses Luganda label", () => {
    expect(receiptPrintActionLabel("lg")).toBe("Fulumya");
  });
});
