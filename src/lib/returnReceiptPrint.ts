/**
 * Post-return / manual Return receipt ESC/POS enqueue.
 *
 * Same queue, printer registry, capability gate, and adapter as retail sales.
 * Document bytes come from buildReturnReceiptEscPos — not the sale mapper.
 * Does not alter return / sale / stock / cash / sync paths.
 */

import type { ReturnReceiptContext } from "./receiptDocuments";
import { buildReturnReceiptEscPos } from "./returnReceiptEscPos";
import { resolveDefaultReceiptPrinter } from "./printerRegistry";
import { enqueuePrintJob } from "./printQueue";
import { dateKeyKampala } from "./datesUg";
import { detectPrinterCapabilities } from "../services/hardware/printerAdapter";
import { canDeliverEscPosWithoutChooser } from "../services/hardware/hardwareTransport";
import type { PrinterProfile } from "../types";

export type ReturnEscPosEnqueueResult = {
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

function queueSaleId(saleId: string | null | undefined): string | null {
  const id = saleId?.trim();
  return id ? id : null;
}

/**
 * Best-effort: enqueue Return ESC/POS when a default receipt printer can deliver.
 * Returns enqueued:false on any miss/failure so callers keep HTML/PDF/share.
 */
export async function tryEnqueueReturnReceiptEscPos(
  ctx: ReturnReceiptContext,
): Promise<ReturnEscPosEnqueueResult> {
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

    const bytes = buildReturnReceiptEscPos(ctx, printer.paperWidth);
    const prefs = await enqueuePrintJob(state.preferences, {
      kind: "receipt",
      printerId: printer.id,
      saleId: queueSaleId(ctx.returnRecord.saleId),
      businessDate: dateKeyKampala(ctx.returnRecord.createdAt),
      payloadSummary: `Return receipt ${ctx.receiptNumber}`,
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
