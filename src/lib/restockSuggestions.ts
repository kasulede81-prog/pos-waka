import type { Language, Product, Purchase, Sale } from "../types";
import { dateKeyKampala, dateKeyDaysAgoKampala } from "./datesUg";
import { isLowStock } from "./sellingEngine";
import { t, tTemplate } from "./i18n";

/** Short, friendly hints for the stock screen / dashboard (no jargon). */
export function buildRestockSuggestions(
  lang: Language,
  products: Product[],
  sales: Sale[],
  purchases: Purchase[],
  max = 5,
): string[] {
  const out: string[] = [];
  const low = products.filter((p) => isLowStock(p));
  if (low.length === 1) {
    out.push(tTemplate(lang, "restockHintSingleLow", { name: low[0]!.name }));
  } else if (low.length > 1) {
    out.push(tTemplate(lang, "restockHintMultiLow", { count: String(low.length) }));
  }

  const unitsLast7 = (productId: string): number => {
    let u = 0;
    for (let d = 0; d < 7; d++) {
      const k = dateKeyDaysAgoKampala(d);
      for (const s of sales) {
        if (dateKeyKampala(s.createdAt) !== k) continue;
        for (const line of s.lines) {
          if (line.productId === productId) u += line.quantity;
        }
      }
    }
    return u;
  };

  for (const p of products) {
    if (out.length >= max) break;
    if (isLowStock(p)) continue;
    const sold = unitsLast7(p.id);
    const avg = sold / 7;
    if (avg >= 0.35 && p.stockOnHand > 0 && p.stockOnHand < avg * 6) {
      out.push(tTemplate(lang, "restockHintRunningLower", { name: p.name }));
    }
  }

  const lastPurchaseDaysAgo = (productId: string): number | null => {
    let latest = 0;
    for (const pur of purchases) {
      if (!pur.lines.some((l) => l.productId === productId)) continue;
      const t0 = new Date(pur.createdAt).getTime();
      if (t0 > latest) latest = t0;
    }
    if (!latest) return null;
    return Math.floor((Date.now() - latest) / 86400000);
  };

  for (const p of products) {
    if (out.length >= max) break;
    if (isLowStock(p)) continue;
    const days = lastPurchaseDaysAgo(p.id);
    const sold = unitsLast7(p.id);
    if (days !== null && days >= 12 && sold >= 3) {
      out.push(tTemplate(lang, "restockHintNotBoughtAWhile", { name: p.name }));
    }
  }

  if (out.length === 0 && products.length > 0) {
    out.push(t(lang, "restockHintAllOk"));
  }

  return out.slice(0, max);
}
