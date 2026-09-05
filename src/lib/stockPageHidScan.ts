import type { Product } from "../types";
import { findProductByBarcode } from "./pharmacyMedicine";
import { usePosStore } from "../store/usePosStore";

export type StockPageHidScanResult = {
  listQuery: string;
  detailProduct: Product | null;
};

/**
 * StockPage HID onScan contract: always search the scanned code.
 * Pharmacy mode also opens the matching product detail when found.
 * Reads the live store catalog so the scanner session need not restart
 * when the products array identity changes.
 */
export function resolveStockPageHidScan(code: string, pharmacyMode: boolean): StockPageHidScanResult {
  const products = usePosStore.getState().products;
  const hit = pharmacyMode ? (findProductByBarcode(products, code) ?? null) : null;
  return { listQuery: code, detailProduct: hit };
}
