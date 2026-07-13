/**
 * Phase 25.3 — authoritative POS catalog scroll owner resolution.
 */

export const POS_CATALOG_SCROLL_ATTR = "data-pos-catalog-scroll";

export function findCatalogScrollElement(from?: HTMLElement | null): HTMLElement | null {
  if (from) {
    const nearest = from.closest<HTMLElement>(`[${POS_CATALOG_SCROLL_ATTR}]`);
    if (nearest) return nearest;
  }
  return document.querySelector<HTMLElement>(`[${POS_CATALOG_SCROLL_ATTR}]`);
}

/** Virtualizer and scroll reset must bind only to the catalog pane — never window or main chrome. */
export function requireCatalogScrollElement(from?: HTMLElement | null): HTMLElement | null {
  const el = findCatalogScrollElement(from);
  if (!el && import.meta.env.DEV) {
    console.warn("[waka-pos] catalog_scroll_owner_missing", {
      hint: "Expected [data-pos-catalog-scroll].pos-catalog-scroll-pane",
    });
  }
  return el;
}

export function scrollCatalogToTop(from?: HTMLElement | null): void {
  const el = findCatalogScrollElement(from);
  if (el) el.scrollTop = 0;
}
