import type { Language, Product, ShopPreferences } from "../../../types";
import { executeShopAction, type ShopActionResult } from "../../../lib/shopActionRunner";
import {
  canPersistInventoryArchivePreferences,
  canPersistInventoryProductTagsPreferences,
} from "../../../lib/settingsAuthorization";
import { usePosStore } from "../../../store/usePosStore";
import {
  isProductArchived,
  productSupplierTag,
  readArchivedProductIds,
  readProductTags,
  writeArchivedProductIds,
  writeProductTags,
} from "../filters/inventoryAdvancedFilters";

export type BulkPriceMode = "set" | "adjust_pct" | "adjust_fixed";

export type BulkStockMode = "increase" | "reduce" | "set";

export type BulkTagMode = "add" | "remove" | "set";

export type InventoryBulkOperation =
  | { kind: "category"; category: string }
  | { kind: "shelf"; shelf: string }
  | { kind: "sellingPrice"; mode: BulkPriceMode; valueUgx: number; reason?: string }
  | { kind: "cost"; mode: BulkPriceMode; valueUgx: number }
  | { kind: "stock"; mode: BulkStockMode; value: number; reason: string }
  | { kind: "archive" }
  | { kind: "unarchive" }
  | { kind: "activate" }
  | { kind: "deactivate" }
  | { kind: "tags"; mode: BulkTagMode; tags: string[] }
  | { kind: "supplier"; supplierId: string; supplierName: string };

type BulkStore = {
  updateProduct: (
    productId: string,
    patch: Partial<Product>,
    opts?: { auditReason?: string },
  ) => { ok: boolean; errorKey?: string };
  adjustStock: (productId: string, delta: number, reason?: string) => { ok: boolean; errorKey?: string };
  setPreferences: (p: Partial<ShopPreferences>, opts?: { silent?: boolean }) => void;
};

export type BulkOperationContext = {
  lang: Language;
  products: Product[];
  selectedIds: Set<string>;
  preferences: ShopPreferences;
  store: BulkStore;
  setBusy?: (busy: boolean) => void;
  onSuccess?: (message?: string) => void;
  onError?: (message: string) => void;
};

function resolvePrice(base: number, mode: BulkPriceMode, valueUgx: number): number {
  if (mode === "set") return Math.max(0, Math.round(valueUgx));
  if (mode === "adjust_pct") return Math.max(0, Math.round(base * (1 + valueUgx / 100)));
  return Math.max(0, Math.round(base + valueUgx));
}

/** Same class of canned reason bulk stock already passes to `adjustStock`. */
export const BULK_PRICE_AUDIT_REASON = "Bulk price update";

/**
 * Sequential single-archive contract: each product is unioned into (or removed
 * from) the live archived-id set. Bulk must produce the same end state as
 * applying this once per selected id against the previous result.
 */
export function nextInventoryArchivedProductIds(
  currentIds: readonly string[] | undefined,
  productIds: readonly string[],
  mode: "archive" | "unarchive",
): string[] {
  const ids = new Set(currentIds ?? []);
  if (mode === "archive") {
    for (const id of productIds) ids.add(id);
  } else {
    for (const id of productIds) ids.delete(id);
  }
  return [...ids];
}

/**
 * Sequential single-product supplier-tag contract: each selected id replaces
 * its `supplier:*` tag (other tags on that product stay). Bulk must produce
 * the same end map as applying this once per selected id against the previous
 * result — including when the current map is undefined.
 */
export function nextInventoryProductTagsForSupplier(
  current: Record<string, string[]> | undefined,
  productIds: readonly string[],
  supplierId: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...(current ?? {}) };
  const supplierTag = productSupplierTag(supplierId);
  const seen = new Set<string>();
  for (const id of productIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const cur = (next[id] ?? []).filter((t) => !t.startsWith("supplier:"));
    next[id] = [...cur, supplierTag];
  }
  return next;
}

function applyBulkSupplierPreference(
  op: Extract<InventoryBulkOperation, { kind: "supplier" }>,
  ctx: BulkOperationContext,
  targets: Product[],
): ShopActionResult {
  // setPreferences is void and no-ops on deny. Check the same contract first
  // so unauthorized callers never get "Updated N products".
  if (!canPersistInventoryProductTagsPreferences(usePosStore.getState().sessionActor)) {
    return {
      ok: false,
      errorKey: "forbidden",
      message: "You do not have permission for this action.",
    };
  }
  const current = readProductTags(ctx.preferences);
  const next = nextInventoryProductTagsForSupplier(
    current,
    targets.map((p) => p.id),
    op.supplierId,
  );
  ctx.store.setPreferences(writeProductTags(ctx.preferences, next));
  return {
    ok: true,
    message: `Updated ${targets.length} products`,
  };
}

function applyBulkArchivePreference(
  op: Extract<InventoryBulkOperation, { kind: "archive" | "unarchive" | "activate" }>,
  ctx: BulkOperationContext,
  targets: Product[],
): ShopActionResult {
  const mode = op.kind === "archive" ? "archive" : "unarchive";
  const current = [...readArchivedProductIds(ctx.preferences)];
  let applied = 0;
  let failed = 0;
  const eligibleIds: string[] = [];

  if (op.kind === "archive") {
    for (const p of targets) {
      if (isProductArchived(ctx.preferences, p.id)) continue;
      eligibleIds.push(p.id);
      applied += 1;
    }
    if (applied === 0) return { ok: false, message: "No products updated" };
  } else {
    for (const p of targets) eligibleIds.push(p.id);
  }

  ctx.store.setPreferences(
    writeArchivedProductIds(ctx.preferences, nextInventoryArchivedProductIds(current, eligibleIds, mode)),
  );

  // setPreferences denies silently (void). Archive/unarchive must not report
  // success when the store-authoritative settings.shop gate rejected the write.
  if (
    (op.kind === "archive" || op.kind === "unarchive") &&
    !canPersistInventoryArchivePreferences(usePosStore.getState().sessionActor)
  ) {
    return {
      ok: false,
      errorKey: "forbidden",
      message: "You do not have permission for this action.",
    };
  }

  if (op.kind === "activate") {
    for (const p of targets) {
      if (!p.menu?.hideFromMenu) {
        applied += 1;
        continue;
      }
      const r = ctx.store.updateProduct(p.id, {
        menu: { ...p.menu, hideFromMenu: false },
      });
      if (r.ok) applied += 1;
      else failed += 1;
    }
  } else if (op.kind === "unarchive") {
    applied = targets.length;
  }

  if (applied === 0) return { ok: false, message: "No products updated" };
  return {
    ok: true,
    message: failed > 0 ? `Updated ${applied}; ${failed} skipped` : `Updated ${applied} products`,
  };
}

function applyBulkOperation(
  op: InventoryBulkOperation,
  product: Product,
  ctx: BulkOperationContext,
): { ok: boolean; message?: string } {
  const { store, preferences } = ctx;

  switch (op.kind) {
    case "category":
    case "shelf": {
      const r = store.updateProduct(product.id, { category: op.kind === "category" ? op.category : op.shelf });
      return { ok: r.ok, message: r.errorKey };
    }
    case "sellingPrice": {
      const next = resolvePrice(product.sellingPricePerUnitUgx, op.mode, op.valueUgx);
      const r = store.updateProduct(
        product.id,
        { sellingPricePerUnitUgx: next },
        { auditReason: op.reason ?? BULK_PRICE_AUDIT_REASON },
      );
      return { ok: r.ok, message: r.errorKey };
    }
    case "cost": {
      const next = resolvePrice(product.costPricePerUnitUgx, op.mode, op.valueUgx);
      const r = store.updateProduct(product.id, { costPricePerUnitUgx: next });
      return { ok: r.ok, message: r.errorKey };
    }
    case "stock": {
      let delta = 0;
      if (op.mode === "increase") delta = op.value;
      else if (op.mode === "reduce") delta = -op.value;
      else delta = op.value - product.stockOnHand;
      if (delta === 0) return { ok: true };
      const r = store.adjustStock(product.id, delta, op.reason);
      return { ok: r.ok, message: r.errorKey };
    }
    case "deactivate": {
      const r = store.updateProduct(product.id, {
        menu: { ...(product.menu ?? {}), hideFromMenu: true },
      });
      return { ok: r.ok, message: r.errorKey };
    }
    case "tags": {
      const all = readProductTags(preferences);
      const cur = new Set(all[product.id] ?? []);
      if (op.mode === "set") {
        all[product.id] = [...op.tags];
      } else if (op.mode === "add") {
        for (const tag of op.tags) cur.add(tag);
        all[product.id] = [...cur];
      } else {
        for (const tag of op.tags) cur.delete(tag);
        all[product.id] = [...cur];
      }
      store.setPreferences({ inventoryProductTags: all });
      return { ok: true };
    }
    default:
      return { ok: false, message: "Unknown bulk operation" };
  }
}

export async function runInventoryBulkOperation(
  op: InventoryBulkOperation,
  ctx: BulkOperationContext,
): Promise<ShopActionResult> {
  const targets = ctx.products.filter((p) => ctx.selectedIds.has(p.id));
  if (targets.length === 0) {
    return { ok: false, message: "No products selected" };
  }

  return executeShopAction(
    {
      setBusy: ctx.setBusy,
      onSuccess: ctx.onSuccess,
      onError: ctx.onError,
      audit: { action: `inventory_bulk_${op.kind}`, metadata: { count: targets.length } },
    },
    async () => {
      if (op.kind === "archive" || op.kind === "unarchive" || op.kind === "activate") {
        return applyBulkArchivePreference(op, ctx, targets);
      }
      if (op.kind === "supplier") {
        return applyBulkSupplierPreference(op, ctx, targets);
      }
      let applied = 0;
      let failed = 0;
      for (const p of targets) {
        const r = applyBulkOperation(op, p, ctx);
        if (r.ok) applied += 1;
        else failed += 1;
      }
      if (applied === 0) return { ok: false, message: "No products updated" };
      return {
        ok: true,
        message: failed > 0 ? `Updated ${applied}; ${failed} skipped` : `Updated ${applied} products`,
      };
    },
  );
}

export function selectedProducts(products: Product[], selectedIds: Set<string>): Product[] {
  return products.filter((p) => selectedIds.has(p.id));
}
