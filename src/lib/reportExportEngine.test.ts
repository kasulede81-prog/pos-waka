import { describe, expect, it, vi } from "vitest";

vi.mock("./fileDownload", () => ({
  saveExportedFile: vi.fn(async () => true),
}));

vi.mock("./nativePrintFallback", () => ({
  printDocumentNativeFallback: vi.fn(async () => true),
}));

import { saveExportedFile } from "./fileDownload";
import { exportCsvFile, exportPdfFile } from "./reportExportEngine";

describe("reportExportEngine", () => {
  it("routes CSV export through saveExportedFile", async () => {
    const result = await exportCsvFile("reports", "test.csv", [["a", "b"]]);
    expect(result.ok).toBe(true);
    expect(saveExportedFile).toHaveBeenCalledWith(
      "test.csv",
      expect.stringContaining("a,b"),
      "text/csv;charset=utf-8",
      undefined,
    );
  });

  it("routes PDF export through saveExportedFile", async () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const result = await exportPdfFile("reports", "test.pdf", blob);
    expect(result.ok).toBe(true);
    expect(saveExportedFile).toHaveBeenCalledWith("test.pdf", blob, "application/pdf", undefined);
  });
});
