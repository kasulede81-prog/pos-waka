import type { EntityManifest } from "../offline/entityStore";
import type { PersistedSnapshot } from "../offline/localDb";
import type { Product, Sale } from "../types";

export type TombstoneBundle = {
  deletedProductIds: Record<string, string>;
  voidedSaleIds: Record<string, string>;
};

const emptyBundle = (): TombstoneBundle => ({
  deletedProductIds: {},
  voidedSaleIds: {},
});

/** Collect tombstone ids from a snapshot envelope (backup / cloud / restore). */
export function tombstonesFromSnapshot(snap: Partial<PersistedSnapshot>): TombstoneBundle {
  const bundle = emptyBundle();
  const now = new Date().toISOString();

  for (const id of snap.deletedProductIds ?? []) {
    if (id) bundle.deletedProductIds[id] = bundle.deletedProductIds[id] ?? now;
  }
  for (const id of snap.voidedSaleIds ?? []) {
    if (id) bundle.voidedSaleIds[id] = bundle.voidedSaleIds[id] ?? now;
  }

  return bundle;
}

export function tombstonesFromManifest(
  manifest: Pick<EntityManifest, "tombstones" | "voidedSaleIds"> | null | undefined,
): TombstoneBundle {
  if (!manifest) return emptyBundle();
  return {
    deletedProductIds: { ...(manifest.tombstones ?? {}) },
    voidedSaleIds: { ...(manifest.voidedSaleIds ?? {}) },
  };
}

export function mergeTombstoneBundles(a: TombstoneBundle, b: TombstoneBundle): TombstoneBundle {
  return {
    deletedProductIds: { ...a.deletedProductIds, ...b.deletedProductIds },
    voidedSaleIds: { ...a.voidedSaleIds, ...b.voidedSaleIds },
  };
}

export function mergeTombstoneIdLists(
  bundle: TombstoneBundle,
  deletedProductIds: string[],
  voidedSaleIds: string[],
): TombstoneBundle {
  const now = new Date().toISOString();
  const next = { ...bundle, deletedProductIds: { ...bundle.deletedProductIds }, voidedSaleIds: { ...bundle.voidedSaleIds } };
  for (const id of deletedProductIds) {
    if (id) next.deletedProductIds[id] = next.deletedProductIds[id] ?? now;
  }
  for (const id of voidedSaleIds) {
    if (id) next.voidedSaleIds[id] = next.voidedSaleIds[id] ?? now;
  }
  return next;
}

export function applyTombstonesToManifest(manifest: EntityManifest, bundle: TombstoneBundle): EntityManifest {
  return {
    ...manifest,
    tombstones: { ...manifest.tombstones, ...bundle.deletedProductIds },
    voidedSaleIds: { ...(manifest.voidedSaleIds ?? {}), ...bundle.voidedSaleIds },
  };
}

export function snapshotFieldsFromTombstones(bundle: TombstoneBundle): Pick<PersistedSnapshot, "deletedProductIds" | "voidedSaleIds"> {
  return {
    deletedProductIds: Object.keys(bundle.deletedProductIds),
    voidedSaleIds: Object.keys(bundle.voidedSaleIds),
  };
}

export function filterProductsByTombstones(products: Product[], bundle: TombstoneBundle): Product[] {
  const deleted = bundle.deletedProductIds;
  return products.filter((p) => !deleted[p.id]);
}

export function filterSalesByTombstones(sales: Sale[], bundle: TombstoneBundle): Sale[] {
  const voided = bundle.voidedSaleIds;
  return sales.filter((s) => !voided[s.id]);
}

/** Strip tombstoned entities and attach tombstone id lists for backup/export. */
export function attachTombstonesToSnapshot(snap: PersistedSnapshot, bundle: TombstoneBundle): PersistedSnapshot {
  const merged = mergeTombstoneBundles(tombstonesFromSnapshot(snap), bundle);
  return {
    ...snap,
    ...snapshotFieldsFromTombstones(merged),
    products: filterProductsByTombstones(snap.products, merged),
    sales: filterSalesByTombstones(snap.sales, merged),
    archivedSales: filterSalesByTombstones(snap.archivedSales ?? [], merged),
  };
}

export function countTombstones(bundle: TombstoneBundle): { products: number; sales: number } {
  return {
    products: Object.keys(bundle.deletedProductIds).length,
    sales: Object.keys(bundle.voidedSaleIds).length,
  };
}
