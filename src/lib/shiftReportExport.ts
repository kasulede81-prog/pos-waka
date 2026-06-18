import type { Language, ShiftRecord } from "../types";
import { t } from "./i18n";
import { formatShiftDuration, shiftStatusLabel } from "./shiftEnforcement";
import { shiftExpectedCash } from "./saleAdjustments";

export type ShiftSummaryRow = {
  shift: ShiftRecord;
  durationLabel: string;
  expectedCashUgx: number;
  refundsUgx: number;
};

export function buildShiftSummaryRows(shifts: ShiftRecord[], nowMs = Date.now()): ShiftSummaryRow[] {
  return [...shifts]
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .map((shift) => ({
      shift,
      durationLabel: shift.endAt
        ? formatShiftDuration(shift.startAt, new Date(shift.endAt).getTime())
        : formatShiftDuration(shift.startAt, nowMs),
      expectedCashUgx: shiftExpectedCash(shift),
      refundsUgx: (shift.returnsTotalUgx ?? 0) + (shift.voidsTotalUgx ?? 0),
    }));
}

export function buildShiftSummaryCsv(lang: Language, rows: ShiftSummaryRow[]): string {
  const headers = [
    t(lang, "shiftReportCashier"),
    t(lang, "shiftReportStart"),
    t(lang, "shiftReportEnd"),
    t(lang, "shiftReportDuration"),
    t(lang, "shiftReportSales"),
    t(lang, "shiftReportDebt"),
    t(lang, "shiftReportRefunds"),
    t(lang, "shiftReportCounted"),
    t(lang, "shiftReportDifference"),
    t(lang, "shiftReportStatus"),
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const sh = row.shift;
    lines.push(
      [
        csvCell(sh.actorName ?? sh.actorUserId),
        csvCell(sh.startAt),
        csvCell(sh.endAt ?? ""),
        csvCell(row.durationLabel),
        sh.salesTotalUgx,
        sh.debtPaymentsTotalUgx ?? 0,
        row.refundsUgx,
        sh.countedCashUgx ?? "",
        sh.cashDifferenceUgx ?? "",
        shiftStatusLabel(sh),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadShiftSummaryCsv(lang: Language, rows: ShiftSummaryRow[]): void {
  const blob = new Blob([buildShiftSummaryCsv(lang, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `waka-shift-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadShiftSummaryPdf(lang: Language, rows: ShiftSummaryRow[]): void {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  const title = t(lang, "shiftReportTitle");
  const tableRows = rows
    .map((row) => {
      const sh = row.shift;
      return `<tr>
        <td>${escapeHtml(sh.actorName ?? sh.actorUserId)}</td>
        <td>${escapeHtml(formatTs(sh.startAt))}</td>
        <td>${escapeHtml(sh.endAt ? formatTs(sh.endAt) : "—")}</td>
        <td>${escapeHtml(row.durationLabel)}</td>
        <td>${sh.salesTotalUgx.toLocaleString()}</td>
        <td>${(sh.debtPaymentsTotalUgx ?? 0).toLocaleString()}</td>
        <td>${row.refundsUgx.toLocaleString()}</td>
        <td>${sh.countedCashUgx != null ? sh.countedCashUgx.toLocaleString() : "—"}</td>
        <td>${sh.cashDifferenceUgx != null ? sh.cashDifferenceUgx.toLocaleString() : "—"}</td>
        <td>${shiftStatusLabel(sh)}</td>
      </tr>`;
    })
    .join("");
  win.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 20px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f5f5f4; }
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <table>
      <thead><tr>
        <th>${escapeHtml(t(lang, "shiftReportCashier"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportStart"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportEnd"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportDuration"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportSales"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportDebt"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportRefunds"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportCounted"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportDifference"))}</th>
        <th>${escapeHtml(t(lang, "shiftReportStatus"))}</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 500); };</script>
    </body></html>`);
  win.document.close();
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
