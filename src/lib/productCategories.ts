import type { Product } from "../types";

/** Stored in preferences / filters for products with no category text. */
export const UNCATEGORIZED_SENTINEL = "__waka_uncategorized__";

/** Internal “show every product” value (not persisted; preferences use undefined for All). */
export const CATEGORY_FILTER_ALL = "__waka_all__";

export function normalizedCategoryKey(p: Product): string {
  return (p.category ?? "").trim();
}

/** Distinct non-empty `category` values, A–Z. */
export function distinctTrimmedCategories(products: readonly Product[]): string[] {
  const seen = new Set<string>();
  for (const p of products) {
    const c = normalizedCategoryKey(p);
    if (c.length > 0) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function productMatchesCategoryFilter(p: Product, filter: string): boolean {
  if (filter === CATEGORY_FILTER_ALL) return true;
  if (filter === UNCATEGORIZED_SENTINEL) return normalizedCategoryKey(p).length === 0;
  return normalizedCategoryKey(p) === filter;
}

function normalizeSpacing(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Strip punctuation so "screen-guard" matches queries like "screen guard". */
function looseTokenForm(s: string): string {
  return normalizeSpacing(s.replace(/[^\p{L}\p{N}]+/gu, " "));
}

function hayContainsAllTokens(hay: string, hayLoose: string, tokens: string[], tokensLoose: string[]): boolean {
  const single = hayLoose.includes(tokensLoose.join(" "));
  if (single) return true;
  return tokens.every(
    (tok, i) => hay.includes(tok) || hayLoose.includes(tokensLoose[i]!) || hayLoose.split(" ").includes(tokensLoose[i]!),
  );
}

/** Sell search: phrase or word tokens against name, category, unit, SKU, buying hint, or alias expansions. */
export function productMatchesSellSearch(p: Product, query: string, aliasTerms: string[] = []): boolean {
  const raw = query.trim();
  if (!raw) return true;

  const q = normalizeSpacing(raw);
  const qLoose = looseTokenForm(raw);

  const cat = normalizeSpacing(p.category ?? "");
  const name = normalizeSpacing(p.name);
  const hay = `${name} · ${cat} · ${normalizeSpacing(`${p.baseUnit}`)} · ${normalizeSpacing(p.sku)} · ${normalizeSpacing(p.buyingUnit ?? "")}`;
  const hayLoose = looseTokenForm(`${p.name} ${p.category ?? ""} ${p.baseUnit} ${p.sku} ${p.buyingUnit ?? ""}`);

  if (hay.includes(q) || hayLoose.includes(qLoose) || cat.includes(q) || looseTokenForm(cat).includes(qLoose)) return true;

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
