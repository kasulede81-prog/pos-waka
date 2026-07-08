import type { Product } from "../types";
import type { EnterpriseStockTransfer } from "../types/enterprise";
import { productMatchesSellSearch } from "./productCategories";
import { isControlledProduct } from "./pharmacyControlledMedicine";

export type TransferProgressStage = "location" | "products" | "review" | "transfer" | "complete";

export const TRANSFER_PROGRESS_STAGES: TransferProgressStage[] = [
  "location",
  "products",
  "review",
  "transfer",
  "complete",
];

export type TransferLocation = {
  id: string;
  name: string;
  code?: string | null;
};

export type TransferLineDraft = {
  productId: string;
  quantity: number;
  batchId?: string;
};

export type TransferDraftMetadata = {
  id: string;
  sourceShopId: string;
  sourceShopName: string;
  destinationShopId: string | null;
  destinationShopName: string | null;
  lines: TransferLineDraft[];
  controlledTransfer: boolean;
  preparedAt: string;
};

export function transferProgressIndex(stage: TransferProgressStage): number {
  return TRANSFER_PROGRESS_STAGES.indexOf(stage);
}

/** Presentation-only location resolution — single-store today, multi-branch ready. */
export function resolveTransferLocations(
  shopName: string,
  shopId?: string | null,
  branches?: TransferLocation[],
): {
  source: TransferLocation;
  destinations: TransferLocation[];
  isSingleBranch: boolean;
} {
  const source: TransferLocation = {
    id: shopId?.trim() || "current-shop",
    name: shopName.trim() || "Current shop",
  };
  const all = branches ?? [];
  const destinations = all.filter((b) => b.id !== source.id);
  return {
    source,
    destinations,
    isSingleBranch: destinations.length === 0,
  };
}

export function filterTransferProducts(products: Product[], query: string): Product[] {
  const q = query.trim();
  if (!q) return products.filter((p) => p.stockOnHand > 0);
  return products.filter((p) => p.stockOnHand > 0 && productMatchesSellSearch(p, q));
}

export type TransferPresentationValidation = {
  ok: boolean;
  errorKey?: string;
  warningKey?: string;
};

/** Presentation-only validation — does not mutate inventory. */
export function validateTransferLinePresentation(
  product: Product,
  quantity: number,
  batchRemaining?: number,
): TransferPresentationValidation {
  const qty = Math.max(0, Math.floor(quantity));
  if (qty <= 0) return { ok: false, errorKey: "xferInvalidQty" };
  if (qty > product.stockOnHand) return { ok: false, errorKey: "xferInsufficientStock" };
  if (batchRemaining != null && qty > batchRemaining) {
    return { ok: false, errorKey: "xferExceedsBatchQty" };
  }
  if (isControlledProduct(product)) {
    return { ok: true, warningKey: "xferControlledApprovalSoon" };
  }
  return { ok: true };
}

export function buildTransferDraftMetadata(input: {
  source: TransferLocation;
  destination: TransferLocation | null;
  lines: TransferLineDraft[];
  products: Product[];
}): TransferDraftMetadata {
  const controlledTransfer = input.lines.some((ln) => {
    const p = input.products.find((x) => x.id === ln.productId);
    return p ? isControlledProduct(p) : false;
  });
  return {
    id: `xfer-draft-${Date.now()}`,
    sourceShopId: input.source.id,
    sourceShopName: input.source.name,
    destinationShopId: input.destination?.id ?? null,
    destinationShopName: input.destination?.name ?? null,
    lines: input.lines,
    controlledTransfer,
    preparedAt: new Date().toISOString(),
  };
}

export function summarizeTransferDraft(
  lines: TransferLineDraft[],
  products: Product[],
): {
  productCount: number;
  totalUnits: number;
  estimatedValueUgx: number;
} {
  let totalUnits = 0;
  let estimatedValueUgx = 0;
  const seen = new Set<string>();
  for (const ln of lines) {
    if (ln.quantity <= 0) continue;
    seen.add(ln.productId);
    totalUnits += ln.quantity;
    const p = products.find((x) => x.id === ln.productId);
    if (p) estimatedValueUgx += Math.round(ln.quantity * Math.max(0, p.costPricePerUnitUgx));
  }
  return { productCount: seen.size, totalUnits, estimatedValueUgx };
}

/** Maps draft metadata to enterprise transfer shape for future engine hook-up. */
export function toEnterpriseTransferShape(
  draft: TransferDraftMetadata,
  products: Product[],
): Pick<EnterpriseStockTransfer, "fromShopId" | "toShopId" | "controlledTransfer" | "lines" | "status"> {
  return {
    fromShopId: draft.sourceShopId,
    toShopId: draft.destinationShopId ?? "",
    status: "draft",
    controlledTransfer: draft.controlledTransfer,
    lines: draft.lines.map((ln, i) => {
      const p = products.find((x) => x.id === ln.productId);
      return {
        id: `line-${i}`,
        productId: ln.productId,
        productName: p?.name ?? ln.productId,
        quantity: ln.quantity,
        batchId: ln.batchId ?? null,
        batchNumber: null,
        batchExpiry: null,
        unitCostUgx: p?.costPricePerUnitUgx ?? 0,
        receivedQuantity: 0,
      };
    }),
  };
}
