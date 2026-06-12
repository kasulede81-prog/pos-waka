import type { Sale } from "../types";
import { usePosStore } from "../store/usePosStore";

function saleTotalUgx(sale: Sale): number {
  return sale.totalUgx ?? 0;
}

export function logReceiptReprintAudit(sale: Sale, receiptNumber: string): void {
  const total = saleTotalUgx(sale);
  usePosStore.getState().logAuditAction(
    "receipt_reprint",
    `Reprint receipt ${receiptNumber} UGX ${total.toLocaleString()}`,
    { saleId: sale.id, receiptNumber, totalUgx: total },
  );
}

export function logReceiptPdfExportAudit(sale: Sale, receiptNumber: string): void {
  const total = saleTotalUgx(sale);
  usePosStore.getState().logAuditAction(
    "receipt_pdf_export",
    `PDF receipt ${receiptNumber} UGX ${total.toLocaleString()}`,
    { saleId: sale.id, receiptNumber, totalUgx: total },
  );
}
