import type { KitchenTicket, KitchenTicketItem, Language } from "../types";
import { EscPosBuilder, padColumns, wrapText } from "./escPosBuilder";
import { t } from "./i18n";

export type KitchenChitPrintKind = "new" | "modified" | "void" | "course" | "reprint";

function kindBanner(lang: Language, kind: KitchenChitPrintKind): string {
  if (kind === "void") return t(lang, "kitchenChitBannerVoid");
  if (kind === "modified") return t(lang, "kitchenChitBannerModified");
  if (kind === "course") return t(lang, "kitchenChitBannerCourse");
  if (kind === "reprint") return t(lang, "kitchenChitBannerReprint");
  return t(lang, "kitchenChitBannerNew");
}

function formatItemLine(item: KitchenTicketItem, cols: number): string[] {
  const qty = item.itemStatus === "cancelled" ? `VOID ${item.quantity}` : `${item.quantity}x`;
  const head = padColumns(qty, item.productName, cols);
  const lines = [head];
  if (item.variantLabel?.trim()) lines.push(`  ${item.variantLabel.trim()}`);
  for (const mod of item.modifierLabels ?? []) {
    if (mod.trim()) lines.push(`  + ${mod.trim()}`);
  }
  if (item.notes?.trim()) {
    for (const n of wrapText(`** ${item.notes.trim()}`, cols - 2)) lines.push(`  ${n}`);
  }
  return lines;
}

export function buildKitchenChitLines(
  ticket: KitchenTicket,
  lang: Language,
  kind: KitchenChitPrintKind = "new",
  options?: { shopName?: string | null; businessDate?: string | null },
): string[] {
  const lines: string[] = [];
  if (options?.shopName?.trim()) {
    lines.push(options.shopName.trim().toUpperCase());
    lines.push("—");
  }
  lines.push(kindBanner(lang, kind));
  lines.push(`#${ticket.ticketNumber} · ${ticket.stationType.toUpperCase()}`);
  if (ticket.tableLabel) lines.push(`${t(lang, "kitchenChitTable")}: ${ticket.tableLabel}`);
  if (ticket.areaName) lines.push(`${t(lang, "kitchenChitArea")}: ${ticket.areaName}`);
  if (ticket.waiterLabel) lines.push(`${t(lang, "kitchenChitWaiter")}: ${ticket.waiterLabel}`);
  if (ticket.guestCount != null && ticket.guestCount > 0) {
    lines.push(`${t(lang, "kitchenChitGuests")}: ${ticket.guestCount}`);
  }
  if (ticket.orderRound != null) lines.push(`${t(lang, "kitchenChitRound")}: ${ticket.orderRound}`);
  if (ticket.priority && ticket.priority !== "normal") {
    lines.push(`${t(lang, "kitchenChitPriority")}: ${ticket.priority.toUpperCase()}`);
  }
  if (ticket.ticketNotes?.trim()) lines.push(ticket.ticketNotes.trim());
  lines.push("—");
  for (const item of ticket.items) {
    lines.push(...formatItemLine(item, 42));
  }
  lines.push("—");
  const fired = new Date(ticket.firedAt);
  if (options?.businessDate) {
    lines.push(`${t(lang, "kitchenChitBusinessDate")}: ${options.businessDate}`);
  }
  lines.push(
    `${t(lang, "kitchenChitTime")}: ${fired.toLocaleString("en-UG", { dateStyle: "short", timeStyle: "short" })}`,
  );
  if (ticket.ticketNumber) {
    lines.push(`${t(lang, "kitchenChitTicketNo")}: #${ticket.ticketNumber}`);
  }
  return lines;
}

export function buildKitchenChitEscPos(
  ticket: KitchenTicket,
  lang: Language,
  paperWidth: "58mm" | "80mm" = "80mm",
  kind: KitchenChitPrintKind = "new",
  options?: { shopName?: string | null; businessDate?: string | null },
): Uint8Array {
  const b = new EscPosBuilder(paperWidth);
  const textLines = buildKitchenChitLines(ticket, lang, kind, options);
  b.align("center").bold(true).doubleSize(true).textLine(kindBanner(lang, kind)).doubleSize(false).bold(false);
  b.align("left").rule();
  for (const line of textLines.slice(1)) {
    if (line === "—") b.rule();
    else if (line.startsWith("VOID") || kind === "void") b.bold(true).textLine(line).bold(false);
    else b.textLine(line);
  }
  b.feed(4).partialCut();
  return b.build();
}

export function kitchenChitSummary(ticket: KitchenTicket, kind: KitchenChitPrintKind): string {
  const items = ticket.items.map((i) => `${i.quantity}x ${i.productName}`).join(", ");
  return `${kind} #${ticket.ticketNumber} ${ticket.tableLabel} — ${items}`;
}
