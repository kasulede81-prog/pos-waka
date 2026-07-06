import type { PrinterProfile, ShopPreferences } from "../../types";
import { kickCashDrawer } from "./printerAdapter";
import { resolveDefaultReceiptPrinter } from "../../lib/printerRegistry";

/** Cash drawer kick via receipt printer ESC/POS pulse. */
export async function pulseDrawer(prefs?: ShopPreferences): Promise<{ ok: boolean; error?: string }> {
  if (!prefs) return { ok: false, error: "Cash drawer not configured." };
  const printer = resolveDefaultReceiptPrinter(prefs);
  if (!printer) return { ok: false, error: "No receipt printer assigned for cash drawer." };
  return kickCashDrawer(printer);
}

export async function pulseDrawerOnPrinter(printer: PrinterProfile): Promise<{ ok: boolean; error?: string }> {
  return kickCashDrawer(printer);
}
