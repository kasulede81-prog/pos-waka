/**
 * Official WAKA Product Import Template headers (user-facing, not DB names).
 * Parser matches these plus aliases after normalization.
 */
export const CSV_IMPORT_COLUMNS = {
  name: "Product name",
  section: "Section",
  unit: "Unit",
  packSize: "Pack size",
  openingQty: "Opening quantity",
  costPrice: "Cost price",
  sellingPrice: "Selling price",
} as const;

/** Optional extra column — pack label (`buyingUnit`), not in the official 7-column template. */
export const CSV_IMPORT_OPTIONAL_PACK_LABEL = "Pack";

export const CSV_IMPORT_REQUIRED_FIELDS = ["name", "sellingPrice"] as const;

export type CsvImportField =
  | "name"
  | "section"
  | "unit"
  | "packSize"
  | "packLabel"
  | "openingQty"
  | "costPrice"
  | "sellingPrice";

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\(ugx\)/g, "")
    .replace(/[_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES: Record<CsvImportField, readonly string[]> = {
  name: [
    "product name",
    "name",
    "product",
    "item",
    "item name",
    "erinnya lyekintu",
    "erinnya ly ekintu",
  ],
  section: [
    "section",
    "section folder",
    "folder",
    "shelf",
    "category",
    "shelf category",
    "ekifo folder",
    "ekifo",
  ],
  unit: ["unit", "sell unit", "selling unit", "base unit", "sellunit"],
  packSize: [
    "pack size",
    "pieces per pack",
    "units per pack",
    "conversion",
    "conversion rate",
    "obunene bweppak",
    "obunene bw eppak",
  ],
  packLabel: ["pack", "pack label", "buying unit", "pack type"],
  openingQty: [
    "opening quantity",
    "opening qty",
    "quantity",
    "qty",
    "stock",
    "current stock",
    "opening stock",
    "sitoka kati",
  ],
  costPrice: [
    "cost price",
    "cost",
    "buy price",
    "buying price",
    "omuwendo ogugula",
    "omuwendo ogugula ugx",
  ],
  sellingPrice: [
    "selling price",
    "sell price",
    "price",
    "selling price ugx",
    "omutundu gwotunda",
    "omutundu gw otunda ugx",
    "omutundu gwotunda ugx",
  ],
};

const ALIAS_INDEX = new Map<string, CsvImportField>();
for (const [field, names] of Object.entries(ALIASES) as Array<[CsvImportField, readonly string[]]>) {
  for (const name of names) ALIAS_INDEX.set(normalizeHeader(name), field);
}

export function csvImportFieldFromHeader(header: string): CsvImportField | null {
  return ALIAS_INDEX.get(normalizeHeader(header)) ?? null;
}

export function officialCsvImportHeaders(): string[] {
  return [
    CSV_IMPORT_COLUMNS.name,
    CSV_IMPORT_COLUMNS.section,
    CSV_IMPORT_COLUMNS.unit,
    CSV_IMPORT_COLUMNS.packSize,
    CSV_IMPORT_COLUMNS.openingQty,
    CSV_IMPORT_COLUMNS.costPrice,
    CSV_IMPORT_COLUMNS.sellingPrice,
  ];
}

/** Headers we never map — ignored if present so operators cannot import internal ids. */
const IGNORED_INTERNAL = new Set(
  [
    "product_id",
    "product id",
    "id",
    "category_id",
    "category id",
    "metadata",
    "sku",
    "tax_rate",
    "tax rate",
    "tax",
    "barcode",
  ].map(normalizeHeader),
);

export function isIgnoredInternalCsvHeader(header: string): boolean {
  return IGNORED_INTERNAL.has(normalizeHeader(header));
}
