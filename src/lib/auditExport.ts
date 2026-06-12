import type { AuditLogEntry, Language } from "../types";
import { extractAuditDetails, auditActionLabel } from "./auditCenterDetails";
import { actorDisplayLabel } from "./activityNarrative";
import { t } from "./i18n";

function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export type AuditExportRow = {
  timestamp: string;
  staff: string;
  role: string;
  action: string;
  summary: string;
  reason: string;
  before: string;
  after: string;
  device: string;
  entity: string;
};

export function auditEntriesToExportRows(lang: Language, entries: AuditLogEntry[]): AuditExportRow[] {
  return entries.map((e) => {
    const d = extractAuditDetails(e);
    return {
      timestamp: e.at,
      staff: e.actorName?.trim() || actorDisplayLabel(e.actorUserId, lang),
      role: e.role,
      action: auditActionLabel(lang, e.action),
      summary: e.payloadSummary,
      reason: d.reason ?? "",
      before: d.before ?? "",
      after: d.after ?? "",
      device: d.deviceId ?? "",
      entity: d.entityLabel ?? "",
    };
  });
}

export function buildAuditCsv(lang: Language, entries: AuditLogEntry[]): string {
  const rows = auditEntriesToExportRows(lang, entries);
  const header = [
    t(lang, "auditExportColTimestamp"),
    t(lang, "auditExportColStaff"),
    t(lang, "auditExportColRole"),
    t(lang, "auditExportColAction"),
    t(lang, "auditExportColSummary"),
    t(lang, "auditExportColReason"),
    t(lang, "auditExportColBefore"),
    t(lang, "auditExportColAfter"),
    t(lang, "auditExportColDevice"),
    t(lang, "auditExportColEntity"),
  ];
  const lines = [header.map(escCsv).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.timestamp,
        r.staff,
        r.role,
        r.action,
        r.summary,
        r.reason,
        r.before,
        r.after,
        r.device,
        r.entity,
      ]
        .map(escCsv)
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function buildAuditPdfBlob(lang: Language, entries: AuditLogEntry[], shopName: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;
  const lineH = 14;
  const pageH = doc.internal.pageSize.getHeight();

  const addLine = (text: string, bold = false) => {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * lineH + 4;
  };

  addLine(`${t(lang, "auditCenterTitle")} — ${shopName}`, true);
  addLine(`${t(lang, "auditExportGenerated")}: ${new Date().toISOString()}`);
  addLine(`${t(lang, "auditExportCount")}: ${entries.length}`);
  y += 8;

  const rows = auditEntriesToExportRows(lang, entries);
  for (const r of rows.slice(0, 500)) {
    addLine(`${r.timestamp} | ${r.staff} (${r.role}) | ${r.action}`, true);
    addLine(r.summary);
    if (r.reason) addLine(`${t(lang, "auditExportColReason")}: ${r.reason}`);
    if (r.before || r.after) addLine(`${t(lang, "auditExportColBefore")}: ${r.before || "—"} → ${r.after || "—"}`);
    if (r.device) addLine(`${t(lang, "auditExportColDevice")}: ${r.device}`);
    y += 4;
  }

  return doc.output("blob");
}
