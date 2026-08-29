import type { SellingMode } from "../../types";

/**
 * Provenance of a normalized import row. Does not change product business rules.
 * paper_ocr is reserved — this phase does not implement OCR.
 */
export type ProductImportSource = "manual" | "ai" | "csv" | "paper_ocr";

/**
 * Shared import row. Maps 1:1 onto `bulkQuickAddProducts` fields that the
 * retail create engine actually consumes. Extra columns (tax, images, SKU)
 * are omitted because WAKA generate/skips them on create.
 */
export type NormalizedProductImportRow = {
  clientId: string;
  source: ProductImportSource;
  enabled: boolean;
  name: string;
  /** Typed section / folder / shelf from the source (not necessarily Product.category yet). */
  categoryInput: string;
  /**
   * Destination `Product.category` / catalog `legacyShelfKey` after resolution.
   * Empty when missing or ambiguous.
   */
  category: string;
  /** Sell unit — `Product.baseUnit`. */
  baseUnit: string;
  sellingMode?: SellingMode;
  /** Pack label — `Product.buyingUnit`. */
  buyingUnit?: string | null;
  /** Units per pack — `Product.conversionRate`. */
  conversionRate?: number | null;
  /** Opening quantity in sell units — `Product.stockOnHand`. */
  stockQty: number;
  /** `Product.sellingPricePerUnitUgx`. */
  sellingPriceUgx: number;
  /**
   * Unit cost. `null` / omitted = cost missing → existing 72% draft fallback.
   * `0` is an explicit zero cost, not missing.
   */
  costPricePerUnitUgx?: number | null;
  /** Invoice total for one pack when pack-priced. */
  buyingPackCostUgx?: number | null;
  /** 1-based source record number (CSV header = 1). Adapter-only; not stored on Product. */
  sourceRowNumber?: number;
};

export type ImportRowIssueSeverity = "error" | "warning";

export type ImportRowIssueKind =
  | "missing_name"
  | "invalid_price"
  | "invalid_stock"
  | "invalid_cost"
  | "invalid_pack"
  | "missing_category"
  | "ambiguous_category"
  | "unresolved_category"
  | "duplicate_name"
  | "duplicate_existing"
  | "cost_fallback"
  | "suspicious_cost_above_sell"
  | "pharmacy_stock_required"
  | "pharmacy_cost_required";

export type ImportRowIssue = {
  clientId: string;
  kind: ImportRowIssueKind;
  severity: ImportRowIssueSeverity;
};

export type ImportCostStatus = "provided" | "missing_fallback";

export type EvaluatedImportRow = {
  row: NormalizedProductImportRow;
  costStatus: ImportCostStatus;
  fallbackCostUgx: number | null;
  issues: ImportRowIssue[];
  blocking: boolean;
};

/** Payload accepted by `usePosStore.bulkQuickAddProducts`. */
export type BulkQuickAddProductRow = {
  name: string;
  priceUgx: number;
  stockQty: number;
  category: string;
  inferName?: string;
  sellingMode?: SellingMode;
  baseUnit?: string;
  buyingUnit?: string | null;
  conversionRate?: number | null;
  costPricePerUnitUgx?: number | null;
  buyingPackCostUgx?: number | null;
};
