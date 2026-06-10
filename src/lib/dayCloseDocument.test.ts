import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayCloseSummary } from "../types";

const printHtmlDocumentWithDesktop = vi.fn(async (..._args: unknown[]) => true);
const sharePdfBlob = vi.fn(async (..._args: unknown[]) => true);
const isNativePrintPlatform = vi.fn(() => false);

vi.mock("./documentPrint", () => ({
  downloadPdfBlob: vi.fn(async () => true),
  sharePdfBlob: (...args: unknown[]) => sharePdfBlob(...args),
  printHtmlDocumentWithDesktop: (...args: unknown[]) => printHtmlDocumentWithDesktop(...args),
}));

vi.mock("./nativeReceiptPrint", () => ({
  isNativePrintPlatform: () => isNativePrintPlatform(),
}));

import { printDayCloseReport } from "./dayCloseDocument";

describe("day close print fallback", () => {
  const close: DayCloseSummary = {
    id: "c1",
    dateKey: "2026-06-15",
    expectedCashUgx: 100_000,
    countedCashUgx: 100_000,
    differenceUgx: 0,
    totalSalesUgx: 150_000,
    totalDebtUgx: 10_000,
    profitEstimateUgx: 40_000,
    createdAt: "2026-06-15T18:00:00.000Z",
  };

  beforeEach(() => {
    printHtmlDocumentWithDesktop.mockClear();
    sharePdfBlob.mockClear();
    isNativePrintPlatform.mockReturnValue(false);
  });

  it("uses HTML print on web", async () => {
    const ok = await printDayCloseReport("en", close, "Shop");
    expect(ok).toBe(true);
    expect(printHtmlDocumentWithDesktop).toHaveBeenCalled();
    expect(sharePdfBlob).not.toHaveBeenCalled();
  });

  it("uses PDF share fallback on native", async () => {
    isNativePrintPlatform.mockReturnValue(true);
    const ok = await printDayCloseReport("en", close, "Shop");
    expect(ok).toBe(true);
    expect(sharePdfBlob).toHaveBeenCalled();
    expect(printHtmlDocumentWithDesktop).not.toHaveBeenCalled();
  });
});
