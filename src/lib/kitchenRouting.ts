import type { KitchenStation, KitchenStationType, Product, SaleLine } from "../types";

const DRINK_KEYWORDS = /beer|wine|spirit|cocktail|soda|soft|water|juice|drink|lager|gin|vodka|whisky|soda/i;
const FOOD_KEYWORDS = /food|chicken|pork|fish|goat|rice|chips|plate|meat|soup|bread|breakfast|lunch|dinner/i;

export function resolveProductStationType(product: Product): KitchenStationType {
  const cat = (product.category ?? "").toLowerCase();
  const name = product.name.toLowerCase();
  if (DRINK_KEYWORDS.test(cat) || DRINK_KEYWORDS.test(name)) return "bar";
  if (FOOD_KEYWORDS.test(cat) || FOOD_KEYWORDS.test(name)) return "kitchen";
  return "kitchen";
}

export function resolveStationForProduct(
  product: Product,
  stations: KitchenStation[],
): KitchenStation | null {
  const active = stations.filter((s) => s.isActive);
  if (!active.length) return null;
  const preferred = resolveProductStationType(product);
  return active.find((s) => s.stationType === preferred) ?? active[0] ?? null;
}

export function lineQtyByProduct(lines: SaleLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity);
  }
  return map;
}

export function deltaLinesSince(previous: SaleLine[], current: SaleLine[]): SaleLine[] {
  const prev = lineQtyByProduct(previous);
  const out: SaleLine[] = [];
  for (const line of current) {
    const was = prev.get(line.productId) ?? 0;
    const delta = line.quantity - was;
    if (delta > 0.0001) {
      out.push({ ...line, quantity: delta });
    }
  }
  return out;
}
