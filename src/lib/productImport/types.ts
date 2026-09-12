import type { SellingMode } from "../../types";

/**
 * Provenance of a normalized import row. Does not change product business rules.
 * paper_ocr is reserved — this phase does not implement OCR.
 */
export type ProductImportSource = "manual" | "ai" | "csv" | "excel" | "paper_ocr";

/**
 * Wizard pack mode mirrored on the import row.
 * `none` = Template A / unpacked wizard. `packed` = Template B / pack wizard.
 */
export type ProductImportPackMode = "none" | "packed";

/**
 * Shared import row. Maps onto `bulkQuickAddProducts` fields that the
 * retail create engine actually consumes. Extra columns (tax, images, SKU)
 * are omitted because WAKA generate/skips them on create.
 *
 * For packed rows, `stockQty` is always sell units after wizard conversion
 * (`openingPacks × conversionRate`). `buyingPackCostUgx` is cost per pack;
 * `costPricePerUnitUgx` is derived via `unitCostFromPackTotal` when pack cost is set.
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
  /**
   * Distinguishes no-pack vs packed CSV / wizard semantics.
   * Default `none` for non-CSV / AI / manual rows.
   */
  packMode: ProductImportPackMode;
  /** Pack label — `Product.buyingUnit`. Required when `packMode === "packed"`. */
  buyingUnit?: string | null;
  /** Units per pack — `Product.conversionRate`. Required > 1 when packed. */
  conversionRate?: number | null;
  /**
   * Opening packs from Template B / wizard stock step (pack mode ON).
   * Not stored on Product; used to derive `stockQty`.
   */
  openingPacks?: number | null;
  /** Opening quantity in sell units — `Product.stockOnHand`. */
  stockQty: number;
  /** `Product.sellingPricePerUnitUgx`. */
  sellingPriceUgx: number;
  /**
   * Unit cost (per sell unit). `null` / omitted = cost missing → existing 72% draft fallback.
   * `0` is an explicit zero cost, not missing.
   * For packed rows with pack cost, this is derived — do not put pack totals here.
   */
  costPricePerUnitUgx?: number | null;
  /** Invoice total for one pack when pack-priced (wizard buy-pack field). */
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
  | "missing_pack_label"
  | "missing_category"
  | "ambiguous_category"
  | "unresolved_category"
  | "duplicate_name"
  | "duplicate_existing"
  | "cost_fallback"
  | "missing_cost_required"
  | "suspicious_cost_above_sell"
  | "pharmacy_stock_required"
  | "pharmacy_cost_required"
  /** Two or more source columns mapped to the same canonical field; the first was used. */
  | "mapping_ambiguous"
  /** A generic/overloaded header (e.g. bare "Price") was accepted as its best-guess field. */
  | "mapping_unresolved"
  /** A price/cost header referenced a pack unit (carton/box/crate/...) and was not trusted as a unit price. */
  | "mapping_pack_price_conflict";

export type ImportRowIssue = {
  clientId: string;
  kind: ImportRowIssueKind;
  severity: ImportRowIssueSeverity;
};

export type ImportCostStatus = "provided" | "missing_fallback";

/**
 * One worksheet in an uploaded workbook that scored as a plausible product
 * sheet (Phase 1 sheet detection). `headerPreview` is the raw header cells,
 * trimmed, for display in a sheet picker — never used for parsing itself.
 */
export type WorkbookSheetCandidate = {
  sheetName: string;
  headerPreview: readonly string[];
};

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
