import type { Language } from "../types";
import { formatDateTimeKampala, REPORT_TIMEZONE } from "./datesUg";
import { t } from "./i18n";

export type ReportDocumentKind = "daily" | "x_report" | "cash_position" | "profit" | "monthly";

export type ReportDocumentStatus = "closed_day" | "open_day" | "operational";

export type ReportDocumentRow = {
  label: string;
  value: string;
  bold?: boolean;
};

export type ReportDocumentSection = {
  title?: string;
  /** Live operational detail — must not be presented as the closed ledger. */
  live?: boolean;
  rows: ReportDocumentRow[];
};

export type ReportDocumentModel = {
  kind: ReportDocumentKind;
  lang: Language;
  shopName: string;
  organizationName?: string | null;
  title: string;
  periodLabel: string;
  status: ReportDocumentStatus;
  generatedAtIso: string;
  empty: boolean;
  sections: ReportDocumentSection[];
};

export function reportDocumentStatusLabel(lang: Language, status: ReportDocumentStatus): string {
  if (status === "closed_day") return t(lang, "reportDocStatusClosed");
  if (status === "open_day") return t(lang, "reportDocStatusOpen");
  return t(lang, "reportDocStatusOperational");
}

export function reportDocumentGeneratedStamp(iso: string): {
  dateKey: string;
  time: string;
  timeZone: typeof REPORT_TIMEZONE;
  display: string;
} {
  return formatDateTimeKampala(iso);
}

export function statusFromAuthority(
  authority: "live" | "closed_snapshot" | "mixed",
  isSingleDay: boolean,
): ReportDocumentStatus {
  if (authority === "closed_snapshot") return "closed_day";
  if (authority === "live" && isSingleDay) return "open_day";
  if (authority === "live") return "operational";
  return "operational";
}

export function ugxLabel(amount: number): string {
  return `UGX ${amount.toLocaleString()}`;
}
