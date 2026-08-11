import type { Product } from "../types";

export type ProductBarcodeLookup = Map<string, string>;

/** Normalize barcode/SKU key for map lookup. */
export function normalizeBarcodeKey(code: string): string {
  return code.trim().toLowerCase();
}

/** Collect SKU + pharmacy master barcodes for a product. */
export function barcodeKeysForProduct(product: Product): string[] {
  const keys: string[] = [];
  const sku = product.sku?.trim();
  if (sku) keys.push(normalizeBarcodeKey(sku));
  for (const raw of product.pharmacyMaster?.barcodes ?? []) {
    const k = normalizeBarcodeKey(raw);
    if (k) keys.push(k);
  }
  return keys;
}

/**
 * Build code → productId map. First product in array order wins on collisions
 * (matches prior `products.find` semantics).
 */
export function buildProductBarcodeLookup(products: readonly Product[]): ProductBarcodeLookup {
  const map: ProductBarcodeLookup = new Map();
  for (const p of products) {
    for (const key of barcodeKeysForProduct(p)) {
      if (!map.has(key)) map.set(key, p.id);
    }
  }
  return map;
}

/** Remove all keys that currently point at productId, then re-apply product barcodes. */
export function upsertProductBarcodeLookup(
  lookup: ProductBarcodeLookup,
  product: Product,
  productsById?: ReadonlyMap<string, Product>,
): ProductBarcodeLookup {
  const next = new Map(lookup);
  for (const [key, id] of next) {
    if (id === product.id) next.delete(key);
  }
  for (const key of barcodeKeysForProduct(product)) {
    if (!next.has(key)) {
      next.set(key, product.id);
      continue;
    }
    const ownerId = next.get(key)!;
    if (ownerId === product.id) continue;
    const owner = productsById?.get(ownerId);
    if (!owner || !barcodeKeysForProduct(owner).includes(key)) {
      next.set(key, product.id);
    }
  }
  return next;
}

export function removeProductBarcodeLookup(lookup: ProductBarcodeLookup, productId: string): ProductBarcodeLookup {
  const next = new Map(lookup);
  for (const [key, id] of next) {
    if (id === productId) next.delete(key);
  }
  return next;
}

const barcodeLookupCache = new WeakMap<object, ProductBarcodeLookup>();

/** Cached O(1) lookup per products-array identity. */
export function getProductBarcodeLookup(products: readonly Product[]): ProductBarcodeLookup {
  const key = products as object;
  let cached = barcodeLookupCache.get(key);
  if (!cached) {
    cached = buildProductBarcodeLookup(products);
    barcodeLookupCache.set(key, cached);
  }
  return cached;
}

export function findProductIdByBarcode(
  products: readonly Product[],
  code: string,
  lookup?: ProductBarcodeLookup,
): string | undefined {
  const key = normalizeBarcodeKey(code);
  if (!key) return undefined;
  const map = lookup ?? getProductBarcodeLookup(products);
  return map.get(key);
}

/** Resolve product by barcode using cached map (Phase 36.1). */
export function findProductByBarcodeLookup(
  products: readonly Product[],
  code: string,
  lookup?: ProductBarcodeLookup,
): Product | undefined {
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  const id = findProductIdByBarcode(products, trimmed, lookup);
  if (!id) return undefined;
  return products.find((p) => p.id === id);
}
