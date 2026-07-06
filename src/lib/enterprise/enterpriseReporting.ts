import type { EnterpriseReportExportFormat } from "../../types/enterprise";

export type EnterpriseReportKind =
  | "branch_comparison"
  | "sales"
  | "profit"
  | "inventory"
  | "purchases"
  | "hospitality"
  | "pharmacy"
  | "controlled_medicines"
  | "kitchen"
  | "staff"
  | "patients"
  | "customers"
  | "business_dates"
  | "open_shifts"
  | "device_uptime"
  | "sync_health";

export function enterpriseReportLabelKey(kind: EnterpriseReportKind): string {
  return `enterpriseReport_${kind}`;
}

export function supportedExportFormats(): EnterpriseReportExportFormat[] {
  return ["pdf", "excel", "csv"];
}

export function exportMimeType(format: EnterpriseReportExportFormat): string {
  if (format === "pdf") return "application/pdf";
  if (format === "excel") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "text/csv";
}

/** Client-side report window defaults for responsive HQ queries. */
export function defaultReportPageSize(): number {
  return 500;
}
