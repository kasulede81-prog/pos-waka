/**
 * Printable drawer variance history (printing phase 2, item 2).
 *
 * Read-only projection of the history already rendered by CashManagementPage. It
 * prints the rows the operator can see, states the covered window (the snapshot caps
 * the list), and performs no cash calculation or mutation.
 */
import type { Language } from "../types";
import { t } from "./i18n";

export type CashVarianceHistoryRow = {
  id: string;
  dateKey: string;
  differenceUgx: number;
  flagged: boolean;
};

export type CashVarianceDocumentInput = {
  lang: Language;
  shopName: string;
  /** Newest-first, as displayed. */
  rows: CashVarianceHistoryRow[];
};

export type CashVarianceDocument = {
  title: string;
  subtitle: string;
  lines: string[];
};

/** "newest – oldest" window covered by the displayed rows. */
export function cashVarianceRangeLabel(rows: CashVarianceHistoryRow[]): string {
  if (!rows.length) return "—";
  if (rows.length === 1) return rows[0]!.dateKey;
  return `${rows[rows.length - 1]!.dateKey} – ${rows[0]!.dateKey}`;
}

export function buildCashVarianceDocument(input: CashVarianceDocumentInput): CashVarianceDocument {
  return {
    title: t(input.lang, "cashManagementVarianceHistory"),
    subtitle: input.shopName.trim(),
    lines: [
      `${t(input.lang, "reportDocDate")}: ${cashVarianceRangeLabel(input.rows)}`,
      "",
      ...input.rows.map(
        (row) => `${row.dateKey}  ${row.flagged ? "[!] " : ""}UGX ${row.differenceUgx.toLocaleString()}`,
      ),
    ],
  };
}
