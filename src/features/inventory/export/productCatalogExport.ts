import type { Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { actorCanSeeInventoryCostValue } from "../../../lib/inventoryFinancialVisibility";
import type { SessionActor } from "../../../lib/sessionActor";
import type { SubscriptionSnapshot } from "../../../lib/subscriptionEntitlements";
import { formatProductPriceLabel } from "../../../store/usePosStore";
import { normalizedCategoryKey } from "../../../lib/productCategories";
import { productBrandLabel } from "../filters/inventoryAdvancedFilters";

function escCsv(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type ProductCatalogExportScope = "selected" | "filtered" | "all";

export type ProductCatalogCsvOptions = {
  /**
   * Same gate as the products table cost column (`actorCanSeeInventoryCostValue`).
   * When omitted, cost is included only if actor + subscription context allow it.
   * Direct calls with no context are fail-closed (no cost column).
   */
  includeCost?: boolean;
  actor?: SessionActor | null;
  snapshot?: SubscriptionSnapshot;
  authMode?: "supabase" | "local";
};

function resolveCatalogCsvIncludeCost(opts?: ProductCatalogCsvOptions): boolean {
  if (typeof opts?.includeCost === "boolean") return opts.includeCost;
  if (opts?.snapshot && opts.authMode) {
    return actorCanSeeInventoryCostValue(opts.actor, opts.snapshot, opts.authMode);
  }
  return false;
}

export function buildProductCatalogCsv(
  lang: Language,
  products: Product[],
  opts?: ProductCatalogCsvOptions,
): string {
  const includeCost = resolveCatalogCsvIncludeCost(opts);
  const header = [
    t(lang, "inventoryTableProduct"),
    t(lang, "inventoryTableSku"),
    t(lang, "inventoryTableShelf"),
    t(lang, "inventoryTableStock"),
    ...(includeCost ? [t(lang, "inventoryTableCost")] : []),
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
        ...(includeCost ? [Math.round(p.costPricePerUnitUgx)] : []),
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
