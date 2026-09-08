/**
 * Post-payment / manual Debt Payment receipt ESC/POS enqueue.
 *
 * Same queue, printer registry, capability gate, and adapter as retail sales
 * and Return receipts. Document bytes come from buildDebtReceiptEscPos.
 * Does not alter debt / customer balance / cash / sync paths.
 */

import type { DebtPaymentReceiptContext } from "./receiptDocuments";
import { buildDebtReceiptEscPos } from "./debtReceiptEscPos";
import { resolveDefaultReceiptPrinter } from "./printerRegistry";
import { enqueuePrintJob } from "./printQueue";
import { dateKeyKampala } from "./datesUg";
import { detectPrinterCapabilities } from "../services/hardware/printerAdapter";
import { canDeliverEscPosWithoutChooser } from "../services/hardware/hardwareTransport";
import type { PrinterProfile } from "../types";

export type DebtEscPosEnqueueResult = {
  /** True when a job was accepted into the existing print queue. */
  enqueued: boolean;
  /** True when a receipt printer is configured and this runtime can send ESC/POS. */
  nativePrinterConfigured: boolean;
};

function transportSupportsPrinter(
  profile: PrinterProfile,
  caps: Awaited<ReturnType<typeof detectPrinterCapabilities>>,
): boolean {
  if (caps.transports) {
    return canDeliverEscPosWithoutChooser(profile, caps.transports);
  }
  if (!caps.escPosAvailable) return false;
  if (profile.connectionType === "network") return caps.networkAvailable;
  if (profile.connectionType === "bluetooth") return Boolean(caps.nativeBluetoothPrinter);
  if (profile.connectionType === "usb" || profile.connectionType === "builtin") return caps.usbAvailable;
  return false;
}

/**
 * Best-effort: enqueue Debt Payment ESC/POS when a default receipt printer can deliver.
 * Returns enqueued:false on any miss/failure so callers keep HTML/PDF/share.
 */
export async function tryEnqueueDebtReceiptEscPos(
  ctx: DebtPaymentReceiptContext,
): Promise<DebtEscPosEnqueueResult> {
  let nativePrinterConfigured = false;
  try {
    const { usePosStore, flushPendingPersist } = await import("../store/usePosStore");
    const state = usePosStore.getState();
    const printer = resolveDefaultReceiptPrinter(state.preferences);
    if (!printer) return { enqueued: false, nativePrinterConfigured: false };

    const caps = await detectPrinterCapabilities();
    if (!transportSupportsPrinter(printer, caps)) {
      return { enqueued: false, nativePrinterConfigured: false };
    }
    nativePrinterConfigured = true;

    const bytes = buildDebtReceiptEscPos(ctx, printer.paperWidth);
    const prefs = await enqueuePrintJob(state.preferences, {
      kind: "receipt",
      printerId: printer.id,
      saleId: null,
      businessDate: dateKeyKampala(ctx.payment.createdAt),
      payloadSummary: `Debt receipt ${ctx.receiptNumber}`,
      bytes,
    });

    usePosStore.setState({ preferences: prefs });
    flushPendingPersist();
    usePosStore.getState().processPendingPrintQueue();

    return { enqueued: true, nativePrinterConfigured: true };
  } catch {
    return { enqueued: false, nativePrinterConfigured };
  }
}
