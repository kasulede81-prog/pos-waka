import { INVENTORY_PURCHASING_TABS, type InventoryPurchasingTab } from "../features/inventory-purchasing/types";

/** One-shot pharmacy expiry → Products workspace + receive sheet. */
export const PHARMACY_RECEIVE_QUERY = "receive" as const;

export function pharmacyReceiveReplacementHref(productId: string): string {
  const params = new URLSearchParams({
    tab: "products",
    productId: productId.trim(),
    [PHARMACY_RECEIVE_QUERY]: "1",
  });
  return `/pharmacy/inventory?${params.toString()}`;
}

export function inventoryPurchasingTabFromSearch(search: {
  tab?: string | null;
  receive?: string | null;
}): InventoryPurchasingTab {
  const raw = search.tab ?? null;
  if (raw && INVENTORY_PURCHASING_TABS.includes(raw as InventoryPurchasingTab)) {
    return raw as InventoryPurchasingTab;
  }
  if (search.receive === "1") return "products";
  return "overview";
}

export type PharmacyReceiveDeepLinkResult =
  | { action: "noop" }
  | { action: "wait" }
  | { action: "open"; productId: string }
  | { action: "miss" };

/**
 * Resolve a one-shot `receive=1` inventory deep link.
 * Does not invent a product. Does not open a sheet in non-pharmacy mode.
 */
export function resolvePharmacyReceiveDeepLink(input: {
  productId: string | null;
  receive: string | null;
  pharmacyMode: boolean;
  products: readonly { id: string }[];
  hydrated?: boolean;
}): PharmacyReceiveDeepLinkResult {
  if (input.receive !== "1") return { action: "noop" };
  if (!input.pharmacyMode) return { action: "miss" };
  const productId = (input.productId ?? "").trim();
  if (!productId) return { action: "miss" };
  const hit = input.products.find((p) => p.id === productId);
  if (hit) return { action: "open", productId: hit.id };
  if (input.hydrated === false) return { action: "wait" };
  if (input.hydrated == null && input.products.length === 0) return { action: "wait" };
  return { action: "miss" };
}

export function stripPharmacyReceiveQuery(params: URLSearchParams, alsoStripProductId = false): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(PHARMACY_RECEIVE_QUERY);
  if (alsoStripProductId) next.delete("productId");
  return next;
}
