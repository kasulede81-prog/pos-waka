import type { Product } from "../types";
import {
  CATEGORY_FILTER_ALL,
  productMatchesCategoryFilter,
} from "./productCategories";
import { medicineSearchHaystack, productMatchesBarcode } from "./pharmacyMedicine";

function normalizeSpacing(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function looseTokenForm(s: string): string {
  return normalizeSpacing(s.replace(/[^\p{L}\p{N}]+/gu, " "));
}

export type ProductSellSearchEntry = {
  product: Product;
  hay: string;
  hayLoose: string;
  cat: string;
  catLoose: string;
};

export type ProductSellSearchIndex = {
  entries: ProductSellSearchEntry[];
  byId: Map<string, ProductSellSearchEntry>;
};

/** Precompute sell-search haystacks once per catalog revision. */
export function buildProductSellSearchIndex(products: readonly Product[]): ProductSellSearchIndex {
  const entries: ProductSellSearchEntry[] = new Array(products.length);
  const byId = new Map<string, ProductSellSearchEntry>();
  for (let i = 0; i < products.length; i += 1) {
    const p = products[i]!;
    const cat = normalizeSpacing(p.category ?? "");
    const name = normalizeSpacing(p.name);
    const entry: ProductSellSearchEntry = {
      product: p,
      cat,
      catLoose: looseTokenForm(cat),
      hay: `${name} · ${cat} · ${normalizeSpacing(`${p.baseUnit}`)} · ${normalizeSpacing(p.sku)} · ${normalizeSpacing(p.buyingUnit ?? "")} · ${normalizeSpacing(p.medicineStrength ?? "")} · ${normalizeSpacing(p.medicineForm ?? "")}`,
      hayLoose: looseTokenForm(medicineSearchHaystack(p)),
    };
    entries[i] = entry;
    byId.set(p.id, entry);
  }
  return { entries, byId };
}

function hayContainsAllTokens(hay: string, hayLoose: string, tokens: string[], tokensLoose: string[]): boolean {
  const single = hayLoose.includes(tokensLoose.join(" "));
  if (single) return true;
  return tokens.every(
    (tok, i) => hay.includes(tok) || hayLoose.includes(tokensLoose[i]!) || hayLoose.split(" ").includes(tokensLoose[i]!),
  );
}

function entryMatchesSellSearch(entry: ProductSellSearchEntry, query: string, aliasTerms: string[]): boolean {
  const raw = query.trim();
  if (!raw) return true;
  if (productMatchesBarcode(entry.product, raw)) return true;

  const q = normalizeSpacing(raw);
  const qLoose = looseTokenForm(raw);
  const { hay, hayLoose, cat, catLoose } = entry;

  if (hay.includes(q) || hayLoose.includes(qLoose) || cat.includes(q) || catLoose.includes(qLoose)) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  const tokensLoose = tokens.map((t) => looseTokenForm(t)).filter(Boolean);
  if (!tokensLoose.length) return true;

  if (hayContainsAllTokens(hay, hayLoose, tokens, tokensLoose)) return true;

  for (const term of aliasTerms) {
    const tNorm = normalizeSpacing(term);
    const tLoose = looseTokenForm(term);
    if (!tNorm) continue;
    if (hay.includes(tNorm) || hayLoose.includes(tLoose)) return true;
    if (hayContainsAllTokens(hay, hayLoose, [tNorm], [tLoose])) return true;
  }

  return false;
}

export function productMatchesIndexedSellSearch(
  index: ProductSellSearchIndex,
  product: Product,
  query: string,
  aliasTerms: string[],
): boolean {
  const entry = index.byId.get(product.id);
  if (!entry) return false;
  return entryMatchesSellSearch(entry, query, aliasTerms);
}

/** Indexed sell filter — skips haystack rebuild on every keystroke. */
export function filterIndexedProductsForSellView(
  index: ProductSellSearchIndex,
  categoryKey: string,
  query: string,
  aliasTerms: string[],
  favoriteIdSet: ReadonlySet<string>,
): Product[] {
  const q = query.trim();
  const filtered: Product[] = [];
  for (const entry of index.entries) {
    if (!q) {
      if (!productMatchesCategoryFilter(entry.product, categoryKey)) continue;
    } else if (!entryMatchesSellSearch(entry, q, aliasTerms)) {
      continue;
    }
    filtered.push(entry.product);
  }
  filtered.sort((a, b) => {
    const favA = favoriteIdSet.has(a.id) ? 0 : 1;
    const favB = favoriteIdSet.has(b.id) ? 0 : 1;
    if (favA !== favB) return favA - favB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return filtered;
}

/** Fast path when no search query — category filter only. */
export function filterProductsByCategoryOnly(
  products: readonly Product[],
  categoryKey: string,
  favoriteIdSet: ReadonlySet<string>,
): Product[] {
  if (categoryKey === CATEGORY_FILTER_ALL) {
    return [...products].sort((a, b) => {
      const favA = favoriteIdSet.has(a.id) ? 0 : 1;
      const favB = favoriteIdSet.has(b.id) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }
  const filtered: Product[] = [];
  for (const p of products) {
    if (productMatchesCategoryFilter(p, categoryKey)) filtered.push(p);
  }
  filtered.sort((a, b) => {
    const favA = favoriteIdSet.has(a.id) ? 0 : 1;
    const favB = favoriteIdSet.has(b.id) ? 0 : 1;
    if (favA !== favB) return favA - favB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return filtered;
}
