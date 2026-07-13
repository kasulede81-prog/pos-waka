/** CSV / XLSX helpers for BI exports — no accounting logic. */

function escCsv(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: Array<Array<string | number>>): string {
  return `\uFEFF${rows.map((row) => row.map(escCsv).join(",")).join("\n")}`;
}

let xlsxModule: Promise<typeof import("xlsx")> | undefined;

async function loadXlsx(): Promise<typeof import("xlsx")> {
  xlsxModule ??= import("xlsx");
  return xlsxModule;
}

/** Build a real .xlsx workbook blob from rows (first row = header). */
export async function rowsToXlsxBlob(
  rows: Array<Array<string | number>>,
  sheetName = "Report",
): Promise<Blob> {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Yield to the event loop between chunks so large exports stay responsive. */
export async function yieldForExportProgress(processed: number, chunkSize = 2000): Promise<void> {
  if (processed > 0 && processed % chunkSize === 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }
}
