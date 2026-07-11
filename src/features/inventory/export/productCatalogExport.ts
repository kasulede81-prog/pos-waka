import type { Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { normalizedCategoryKey } from "../../../lib/productCategories";
import { productBrandLabel } from "../filters/inventoryAdvancedFilters";

function escCsv(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type ProductCatalogExportScope = "selected" | "filtered" | "all";

export function buildProductCatalogCsv(lang: Language, products: Product[]): string {
  const header = [
    t(lang, "inventoryTableProduct"),
    t(lang, "inventoryTableSku"),
    t(lang, "inventoryTableShelf"),
    t(lang, "inventoryTableStock"),
    t(lang, "inventoryTableCost"),
    t(lang, "inventoryTablePrice"),
    "Brand",
    t(lang, "inventoryTableUpdated"),
  ];
  const lines = [header.map(escCsv).join(",")];
  for (const p of products) {
    const shelf = normalizedCategoryKey(p) ? p.category.trim() : t(lang, "uncategorized");
    lines.push(
      [
        p.name,
        p.sku?.trim() ?? "",
        shelf,
        p.stockOnHand,
        Math.round(p.costPricePerUnitUgx),
        formatProductPriceLabel(p),
        productBrandLabel(p),
        p.updatedAt,
      ]
        .map(escCsv)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}`;
}

export function productCatalogExportFilename(scope: ProductCatalogExportScope): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `waka-inventory-${scope}-${stamp}.csv`;
}
