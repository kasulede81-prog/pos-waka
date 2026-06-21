import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  printHtmlDocumentWithDesktop: vi.fn(async () => true),
  sharePdfBlob: vi.fn(async () => true),
  isNativePrintPlatform: vi.fn(() => false),
}));

vi.mock("./documentPrint", () => ({
  printHtmlDocumentWithDesktop: mocks.printHtmlDocumentWithDesktop,
  sharePdfBlob: mocks.sharePdfBlob,
}));

vi.mock("./nativeReceiptPrint", () => ({
  isNativePrintPlatform: mocks.isNativePrintPlatform,
}));

import { printDocumentNativeFallback } from "./nativePrintFallback";

describe("native print fallback", () => {
  beforeEach(() => {
    mocks.printHtmlDocumentWithDesktop.mockClear();
    mocks.sharePdfBlob.mockClear();
    mocks.isNativePrintPlatform.mockReturnValue(false);
  });

  it("uses HTML print on web", async () => {
    const ok = await printDocumentNativeFallback({
      pdfFilename: "test.pdf",
      buildPdfBlob: () => new Blob(["x"], { type: "application/pdf" }),
      htmlBody: "<p>Hi</p>",
    });
    expect(ok).toBe(true);
    expect(mocks.printHtmlDocumentWithDesktop).toHaveBeenCalled();
    expect(mocks.sharePdfBlob).not.toHaveBeenCalled();
  });

  it("tries HTML print before share sheet on native", async () => {
    mocks.isNativePrintPlatform.mockReturnValue(true);
    mocks.printHtmlDocumentWithDesktop.mockResolvedValueOnce(false);
    const ok = await printDocumentNativeFallback({
      pdfFilename: "test.pdf",
      buildPdfBlob: () => new Blob(["pdf"], { type: "application/pdf" }),
      htmlBody: "<p>Hi</p>",
      shareDialogTitle: "Share receipt",
    });
    expect(ok).toBe(true);
    expect(mocks.printHtmlDocumentWithDesktop).toHaveBeenCalled();
    expect(mocks.sharePdfBlob).toHaveBeenCalled();
  });

  it("skips share when HTML print succeeds on native", async () => {
    mocks.isNativePrintPlatform.mockReturnValue(true);
    mocks.printHtmlDocumentWithDesktop.mockResolvedValueOnce(true);
    const ok = await printDocumentNativeFallback({
      pdfFilename: "test.pdf",
      buildPdfBlob: () => new Blob(["pdf"], { type: "application/pdf" }),
      htmlBody: "<p>Hi</p>",
    });
    expect(ok).toBe(true);
    expect(mocks.printHtmlDocumentWithDesktop).toHaveBeenCalled();
    expect(mocks.sharePdfBlob).not.toHaveBeenCalled();
  });
});
