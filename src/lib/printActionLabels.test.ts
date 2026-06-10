import { describe, expect, it, vi, beforeEach } from "vitest";
import { receiptPrintActionLabel } from "./printActionLabels";

const isNativePrintPlatform = vi.fn(() => false);

vi.mock("./nativeReceiptPrint", () => ({
  isNativePrintPlatform: () => isNativePrintPlatform(),
}));

describe("native print routing labels", () => {
  beforeEach(() => {
    isNativePrintPlatform.mockReturnValue(false);
  });

  it("shows Print on web", () => {
    expect(receiptPrintActionLabel("en")).toBe("Print");
  });

  it("shows Print or Share on native", () => {
    isNativePrintPlatform.mockReturnValue(true);
    expect(receiptPrintActionLabel("en")).toBe("Print or Share");
  });

  it("uses Luganda label on native", () => {
    isNativePrintPlatform.mockReturnValue(true);
    expect(receiptPrintActionLabel("lg")).toBe("Fulumya oba Gabana");
  });
});
