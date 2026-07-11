import type { Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { printHtmlDocument } from "../../../lib/documentPrint";
import { saveExportedFile } from "../../../lib/fileDownload";

function barcodeForProduct(p: Product): string {
  const pharma = p.pharmacyMaster?.barcodes?.[0]?.trim();
  if (pharma) return pharma;
  return p.sku?.trim() ?? p.id.slice(0, 12);
}

function labelHtml(lang: Language, p: Product): string {
  const code = barcodeForProduct(p);
  return `<div class="label" style="width:58mm;padding:6px 8px;border:1px dashed #ccc;margin-bottom:8px;page-break-inside:avoid;">
  <div style="font-size:11px;font-weight:800;line-height:1.2;">${escapeHtml(p.name)}</div>
  <div style="font-size:14px;font-weight:900;margin:4px 0;color:#0d9488;">${escapeHtml(formatProductPriceLabel(p))}</div>
  <div style="font-family:monospace;font-size:10px;letter-spacing:1px;">${escapeHtml(code)}</div>
  <div style="font-size:8px;color:#666;margin-top:2px;">${escapeHtml(t(lang, "inventoryLabelSku"))}: ${escapeHtml(p.sku?.trim() || "—")}</div>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildProductLabelsHtml(lang: Language, products: Product[]): string {
  return products.map((p) => labelHtml(lang, p)).join("");
}

export function printProductLabels(lang: Language, products: Product[]): boolean {
  if (products.length === 0) return false;
  const body = buildProductLabelsHtml(lang, products);
  return printHtmlDocument(body, "58mm", t(lang, "inventoryPrintLabels"));
}

export function exportProductLabelsHtml(lang: Language, products: Product[]): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${t(lang, "inventoryPrintLabels")}</title></head><body>${buildProductLabelsHtml(lang, products)}</body></html>`;
  void saveExportedFile(`waka-labels-${new Date().toISOString().slice(0, 10)}.html`, html, "text/html");
}

export { barcodeForProduct };
