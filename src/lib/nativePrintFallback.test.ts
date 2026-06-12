import { beforeEach, describe, expect, it, vi } from "vitest";

const printHtmlDocumentWithDesktop = vi.fn(async () => true);
const sharePdfBlob = vi.fn(async () => true);
const isNativePrintPlatform = vi.fn(() => false);

vi.mock("./documentPrint", () => ({
  printHtmlDocumentWithDesktop: (...args: unknown[]) => printHtmlDocumentWithDesktop(...args),
  sharePdfBlob: (...args: unknown[]) => sharePdfBlob(...args),
}));

vi.mock("./nativeReceiptPrint", () => ({
  isNativePrintPlatform: () => isNativePrintPlatform(),
}));

import { printDocumentNativeFallback } from "./nativePrintFallback";

describe("native print fallback", () => {
  beforeEach(() => {
    printHtmlDocumentWithDesktop.mockClear();
    sharePdfBlob.mockClear();
    isNativePrintPlatform.mockReturnValue(false);
  });

  it("uses HTML print on web", async () => {
    const ok = await printDocumentNativeFallback({
      pdfFilename: "test.pdf",
      buildPdfBlob: () => new Blob(["x"], { type: "application/pdf" }),
      htmlBody: "<p>Hi</p>",
    });
    expect(ok).toBe(true);
    expect(printHtmlDocumentWithDesktop).toHaveBeenCalled();
    expect(sharePdfBlob).not.toHaveBeenCalled();
  });

  it("generates PDF and opens share sheet on native", async () => {
    isNativePrintPlatform.mockReturnValue(true);
    const ok = await printDocumentNativeFallback({
      pdfFilename: "test.pdf",
      buildPdfBlob: () => new Blob(["pdf"], { type: "application/pdf" }),
      htmlBody: "<p>Hi</p>",
      shareDialogTitle: "Print or share",
    });
    expect(ok).toBe(true);
    expect(sharePdfBlob).toHaveBeenCalled();
    expect(printHtmlDocumentWithDesktop).not.toHaveBeenCalled();
  });
});
