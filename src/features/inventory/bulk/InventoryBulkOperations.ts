import type { Language, Product, ShopPreferences } from "../../../types";
import { executeShopAction, type ShopActionResult } from "../../../lib/shopActionRunner";
import {
  isProductArchived,
  productSupplierTag,
  readArchivedProductIds,
  readProductTags,
} from "../filters/inventoryAdvancedFilters";

export type BulkPriceMode = "set" | "adjust_pct" | "adjust_fixed";

export type BulkStockMode = "increase" | "reduce" | "set";

export type BulkTagMode = "add" | "remove" | "set";

export type InventoryBulkOperation =
  | { kind: "category"; category: string }
  | { kind: "shelf"; shelf: string }
  | { kind: "sellingPrice"; mode: BulkPriceMode; valueUgx: number }
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
      const r = store.updateProduct(product.id, { sellingPricePerUnitUgx: next });
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
    case "archive": {
      const ids = new Set(readArchivedProductIds(preferences));
      ids.add(product.id);
      store.setPreferences({ inventoryArchivedProductIds: [...ids] });
      return { ok: true };
    }
    case "unarchive":
    case "activate": {
      const ids = [...readArchivedProductIds(preferences)].filter((id) => id !== product.id);
      store.setPreferences({ inventoryArchivedProductIds: ids });
      if (op.kind === "activate" && product.menu?.hideFromMenu) {
        const r = store.updateProduct(product.id, {
          menu: { ...product.menu, hideFromMenu: false },
        });
        if (!r.ok) return { ok: false, message: r.errorKey };
      }
      return { ok: true };
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
    case "supplier": {
      const all = readProductTags(preferences);
      const cur = (all[product.id] ?? []).filter((t) => !t.startsWith("supplier:"));
      cur.push(productSupplierTag(op.supplierId));
      all[product.id] = cur;
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
      let applied = 0;
      let failed = 0;
      for (const p of targets) {
        if (isProductArchived(ctx.preferences, p.id) && op.kind !== "unarchive" && op.kind !== "activate") {
          if (op.kind === "archive") continue;
        }
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
