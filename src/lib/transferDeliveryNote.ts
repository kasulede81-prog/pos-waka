/**
 * Printable inter-branch delivery note (printing audit, P1.9).
 *
 * Read-only projection of an existing enterprise transfer record — it prints what the
 * transfer engine already stored and changes no accounting: no stock movement, no
 * status transition, no ledger row.
 */
import type { Language } from "../types";
import { printTextListDocument } from "./nativePrintFallback";
import { sanitizePdfStem } from "./pdfLayout";

export type TransferDeliveryNoteLine = {
  productName: string;
  quantity: number;
  receivedQuantity: number;
  unitCostUgx: number;
};

export type TransferDeliveryNoteInput = {
  lang: Language;
  transferId: string;
  status: string;
  fromShopLabel: string;
  toShopLabel: string;
  shippedAt?: string | null;
  createdAt: string;
  reason?: string | null;
  lines: TransferDeliveryNoteLine[];
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
}

const NOTE_TITLE: Record<Language, string> = {
  en: "Stock transfer delivery note",
  lg: "Ekiwandiiko ky'okutwala ebintu",
  sw: "Hati ya uhamisho wa bidhaa",
};

const LABELS: Record<Language, { transfer: string; from: string; to: string; status: string; shipped: string; created: string; reason: string; item: string; sent: string; received: string }> = {
  en: { transfer: "Transfer", from: "From", to: "To", status: "Status", shipped: "Shipped", created: "Created", reason: "Reason", item: "Item", sent: "Sent", received: "Received" },
  lg: { transfer: "Transfer", from: "Okuva", to: "Okutuuka", status: "Embeera", shipped: "Ekiweereddwa", created: "Kikolebwa", reason: "Sababu", item: "Kintu", sent: "Ebiweereddwa", received: "Ebifuniddwa" },
  sw: { transfer: "Uhamisho", from: "Kutoka", to: "Kwenda", status: "Hali", shipped: "Umetumwa", created: "Umeundwa", reason: "Sababu", item: "Bidhaa", sent: "Zilizotumwa", received: "Zilizopokelewa" },
};

export function buildTransferDeliveryNoteLines(input: TransferDeliveryNoteInput): string[] {
  const l = LABELS[input.lang] ?? LABELS.en;
  const rows: string[] = [
    `${l.transfer}: ${input.transferId.slice(0, 8).toUpperCase()}`,
    `${l.from}: ${input.fromShopLabel}`,
    `${l.to}: ${input.toShopLabel}`,
    `${l.status}: ${input.status}`,
    `${l.created}: ${fmtDate(input.createdAt)}`,
    `${l.shipped}: ${fmtDate(input.shippedAt)}`,
  ];
  if (input.reason?.trim()) rows.push(`${l.reason}: ${input.reason.trim()}`);
  rows.push("");
  rows.push(`${l.item}  |  ${l.sent}  |  ${l.received}`);
  for (const line of input.lines) {
    rows.push(`${line.productName}  |  ${line.quantity}  |  ${line.receivedQuantity}`);
  }
  return rows;
}

export function transferDeliveryNoteHtml(title: string, lines: string[]): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<article><h1>${esc(title)}</h1><pre>${esc(lines.join("\n"))}</pre></article>`;
}

export async function printTransferDeliveryNote(input: TransferDeliveryNoteInput): Promise<boolean> {
  const title = NOTE_TITLE[input.lang] ?? NOTE_TITLE.en;
  const lines = buildTransferDeliveryNoteLines(input);
  return printTextListDocument({
    pdfFilename: `${sanitizePdfStem(`waka-transfer-note-${input.transferId.slice(0, 8)}`)}.pdf`,
    title,
    subtitle: `${input.fromShopLabel} → ${input.toShopLabel}`,
    lines,
    htmlBody: transferDeliveryNoteHtml(title, lines),
    paper: "a4",
  });
}
