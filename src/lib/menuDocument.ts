/**
 * Printable merchant menu (printing phase 2, item 6).
 *
 * Builds the menu currently shown by MenuBuilderPage — grouped by section, with the
 * menuReports.ts performance aggregates the page already displays. Pure presentation:
 * it reads products/sales-derived stats and creates no menu or inventory transaction.
 */
import type { Language, Product, ShopPreferences } from "../types";
import { t } from "./i18n";
import { formatUgx } from "./formatUgx";
import type { DishSaleStat, ModifierPopularityStat } from "./menuReports";

export type MenuDocumentInput = {
  lang: Language;
  preferences: ShopPreferences;
  /** Dishes currently displayed (already filtered by the page's section filter). */
  menuProducts: Product[];
  /** Label of the active section filter, or the "all sections" label. */
  activeSectionLabel: string;
  topDishes: DishSaleStat[];
  topModifiers: ModifierPopularityStat[];
  lowMargin: Array<{ product: Product; marginPct: number }>;
};

export type MenuDocument = {
  title: string;
  subtitle: string;
  lines: string[];
};

export function buildMenuDocument(input: MenuDocumentInput): MenuDocument {
  const { lang } = input;
  const sections = input.preferences.hospitalityMenuSections ?? [];
  const sectionLabel = (key: string) => sections.find((s) => s.id === key)?.label ?? key;

  const bySection = new Map<string, Product[]>();
  for (const product of input.menuProducts) {
    const key = product.menu?.menuSection ?? product.category;
    const bucket = bySection.get(key);
    if (bucket) bucket.push(product);
    else bySection.set(key, [product]);
  }

  const lines: string[] = [];
  for (const [section, dishes] of bySection) {
    lines.push(sectionLabel(section));
    for (const dish of dishes) {
      lines.push(`  ${dish.name}  —  ${formatUgx(dish.sellingPricePerUnitUgx)}`);
    }
    lines.push("");
  }

  // Menu performance — the existing menuReports.ts aggregates.
  lines.push(t(lang, "menuReportsTitle"));
  lines.push(t(lang, "menuTopDishes"));
  for (const d of input.topDishes) lines.push(`  ${d.productName}: ${d.quantitySold}`);
  lines.push(t(lang, "menuTopModifiers"));
  for (const m of input.topModifiers) lines.push(`  ${m.optionLabel}: ${m.count}`);
  lines.push(t(lang, "menuLowMargin"));
  for (const m of input.lowMargin) lines.push(`  ${m.product.name}: ${m.marginPct.toFixed(0)}%`);

  return {
    title: t(lang, "menuBuilderTitle"),
    subtitle: `${input.preferences.shopDisplayName?.trim() || "Waka POS"} · ${input.activeSectionLabel}`,
    lines: lines.length ? lines : ["—"],
  };
}
