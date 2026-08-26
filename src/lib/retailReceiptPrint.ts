/**
 * Phase 1B — post-sale / manual retail receipt ESC/POS enqueue.
 *
 * Wires certified Phase 1A mapper into the existing print queue when a
 * default receipt printer is configured and the current runtime can
 * already deliver ESC/POS. Does not auto-print, wait on checkout, or
 * alter sale / payment / stock / sync paths.
 */

import type { SaleReceiptContext } from "./receiptDocuments";
import { buildReceiptDisplayData } from "./receiptPrint";
import { buildRetailReceiptEscPos } from "./retailReceiptEscPos";
import { resolveDefaultReceiptPrinter } from "./printerRegistry";
import { enqueuePrintJob } from "./printQueue";
import { saleReportingDayKey } from "./datesUg";
import { detectPrinterCapabilities } from "../services/hardware/printerAdapter";
import type { PrinterProfile } from "../types";

export type RetailEscPosEnqueueResult = {
  /** True when a job was accepted into the existing print queue. */
  enqueued: boolean;
};

function transportSupportsPrinter(profile: PrinterProfile, caps: Awaited<ReturnType<typeof detectPrinterCapabilities>>): boolean {
  if (!caps.escPosAvailable) return false;
  if (profile.connectionType === "network") return caps.networkAvailable;
  if (profile.connectionType === "bluetooth") return caps.bluetoothAvailable;
  if (profile.connectionType === "usb" || profile.connectionType === "builtin") return caps.usbAvailable;
  return caps.escPosAvailable;
}

function buildDisplayFromSaleContext(ctx: SaleReceiptContext) {
  return buildReceiptDisplayData({
    shopName: ctx.shopName,
    shopAddress: ctx.shopAddress,
    shopPhone: ctx.shopPhone,
    cashier: ctx.cashier,
    receiptNumber: ctx.receiptNumber,
    sale: ctx.sale,
    productById: ctx.productById,
    customHeaderLines: ctx.customHeaderLines,
    headerLines: ctx.headerLines,
    footerLines: ctx.footerLines,
    footerThanks: ctx.footerThanks,
    footerPowered: ctx.footerPowered ?? undefined,
    returnPolicy: ctx.returnPolicy,
    displayOptions: ctx.displayOptions,
    customerName: ctx.customerName,
    customerPhone: ctx.customerPhone,
    customerBalanceUgx: ctx.customerBalanceUgx,
  });
}

/**
 * Best-effort: enqueue retail ESC/POS for an already-completed sale.
 * Returns enqueued:false on any miss/failure so callers keep HTML/PDF/share.
 */
export async function tryEnqueueRetailSaleReceiptEscPos(ctx: SaleReceiptContext): Promise<RetailEscPosEnqueueResult> {
  try {
    const { usePosStore, flushPendingPersist } = await import("../store/usePosStore");
    const state = usePosStore.getState();
    const printer = resolveDefaultReceiptPrinter(state.preferences);
    if (!printer) return { enqueued: false };

    const caps = await detectPrinterCapabilities();
    if (!transportSupportsPrinter(printer, caps)) return { enqueued: false };

    const display = buildDisplayFromSaleContext(ctx);
    const bytes = buildRetailReceiptEscPos(display, printer.paperWidth);
    const prefs = await enqueuePrintJob(state.preferences, {
      kind: "receipt",
      printerId: printer.id,
      saleId: ctx.sale.id,
      businessDate: saleReportingDayKey(ctx.sale),
      payloadSummary: `Retail receipt ${ctx.receiptNumber}`,
      bytes,
    });

    usePosStore.setState({ preferences: prefs });
    flushPendingPersist();
    usePosStore.getState().processPendingPrintQueue();

    return { enqueued: true };
  } catch {
    return { enqueued: false };
  }
}
