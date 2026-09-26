import { describe, expect, it } from "vitest";
import { receiptPrintActionLabel, statementPrintActionLabel } from "./printActionLabels";

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

  it("labels a supplier statement as a statement, not a receipt", () => {
    // Reusing the receipt label made merchant report buttons read as receipt buttons.
    expect(statementPrintActionLabel("en")).toBe("Print statement");
    expect(statementPrintActionLabel("lg")).not.toBe(receiptPrintActionLabel("lg"));
  });
});
