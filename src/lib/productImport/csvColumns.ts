/**
 * Official WAKA Product Import Template headers (user-facing, not DB names).
 * Two wizard-parity templates — identified by exact header field sets.
 */

export type CsvImportTemplateKind = "no_packs" | "with_packs";

/** Template A — products without packs (wizard pack mode OFF). */
export const CSV_TEMPLATE_A_COLUMNS = {
  name: "Product name",
  section: "Section",
  unit: "Unit",
  openingQty: "Opening quantity",
  costPrice: "Cost price",
  sellingPrice: "Selling price",
} as const;

/** Template B — products with packs (wizard pack mode ON). */
export const CSV_TEMPLATE_B_COLUMNS = {
  name: "Product name",
  section: "Section",
  unit: "Unit",
  packLabel: "Pack",
  packSize: "Pack size",
  openingPacks: "Opening packs",
  costPerPack: "Cost per pack",
  sellingPrice: "Selling price",
} as const;

/** @deprecated Use CSV_TEMPLATE_A_COLUMNS / CSV_TEMPLATE_B_COLUMNS. Kept for call-site greps. */
export const CSV_IMPORT_COLUMNS = {
  name: CSV_TEMPLATE_A_COLUMNS.name,
  section: CSV_TEMPLATE_A_COLUMNS.section,
  unit: CSV_TEMPLATE_A_COLUMNS.unit,
  packSize: CSV_TEMPLATE_B_COLUMNS.packSize,
  openingQty: CSV_TEMPLATE_A_COLUMNS.openingQty,
  costPrice: CSV_TEMPLATE_A_COLUMNS.costPrice,
  sellingPrice: CSV_TEMPLATE_A_COLUMNS.sellingPrice,
  packLabel: CSV_TEMPLATE_B_COLUMNS.packLabel,
  openingPacks: CSV_TEMPLATE_B_COLUMNS.openingPacks,
  costPerPack: CSV_TEMPLATE_B_COLUMNS.costPerPack,
} as const;

export type CsvImportField =
  | "name"
  | "section"
  | "unit"
  | "packSize"
  | "packLabel"
  | "openingQty"
  | "openingPacks"
  | "costPrice"
  | "costPerPack"
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
  openingPacks: [
    "opening packs",
    "packs on hand",
    "number of packs",
    "pack quantity",
    "pack qty",
  ],
  costPrice: [
    "cost price",
    "cost",
    "buy price",
    "buying price",
    "omuwendo ogugula",
    "omuwendo ogugula ugx",
  ],
  costPerPack: [
    "cost per pack",
    "pack cost",
    "buying pack cost",
    "cost of pack",
    "buy pack price",
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

export function officialCsvImportHeadersNoPack(): string[] {
  return [
    CSV_TEMPLATE_A_COLUMNS.name,
    CSV_TEMPLATE_A_COLUMNS.section,
    CSV_TEMPLATE_A_COLUMNS.unit,
    CSV_TEMPLATE_A_COLUMNS.openingQty,
    CSV_TEMPLATE_A_COLUMNS.costPrice,
    CSV_TEMPLATE_A_COLUMNS.sellingPrice,
  ];
}

export function officialCsvImportHeadersWithPack(): string[] {
  return [
    CSV_TEMPLATE_B_COLUMNS.name,
    CSV_TEMPLATE_B_COLUMNS.section,
    CSV_TEMPLATE_B_COLUMNS.unit,
    CSV_TEMPLATE_B_COLUMNS.packLabel,
    CSV_TEMPLATE_B_COLUMNS.packSize,
    CSV_TEMPLATE_B_COLUMNS.openingPacks,
    CSV_TEMPLATE_B_COLUMNS.costPerPack,
    CSV_TEMPLATE_B_COLUMNS.sellingPrice,
  ];
}

/** @deprecated Prefer officialCsvImportHeadersNoPack / WithPack. */
export function officialCsvImportHeaders(): string[] {
  return officialCsvImportHeadersNoPack();
}

const TEMPLATE_A_FIELDS: readonly CsvImportField[] = [
  "name",
  "section",
  "unit",
  "openingQty",
  "costPrice",
  "sellingPrice",
];

const TEMPLATE_B_FIELDS: readonly CsvImportField[] = [
  "name",
  "section",
  "unit",
  "packLabel",
  "packSize",
  "openingPacks",
  "costPerPack",
  "sellingPrice",
];

const TEMPLATE_A_FORBIDDEN: readonly CsvImportField[] = [
  "packSize",
  "packLabel",
  "openingPacks",
  "costPerPack",
];

const TEMPLATE_B_FORBIDDEN: readonly CsvImportField[] = ["openingQty", "costPrice"];

/** Pre–wizard-parity single template (dangerous pack semantics). */
export function isLegacyMixedCsvImportHeader(index: Partial<Record<CsvImportField, number>>): boolean {
  const has = (f: CsvImportField) => index[f] != null;
  return (
    has("name") &&
    has("sellingPrice") &&
    has("packSize") &&
    has("openingQty") &&
    has("costPrice") &&
    !has("openingPacks") &&
    !has("costPerPack")
  );
}

export type DetectCsvImportTemplateResult =
  | { status: "ok"; kind: CsvImportTemplateKind }
  | { status: "legacy" }
  | { status: "unknown"; messageKey: string; params?: Record<string, string> };

/**
 * Identify Template A vs B from mapped header fields (not filename).
 * Legacy mixed 7-column headers are rejected — they are not wizard-parity for packs.
 */
export function detectCsvImportTemplate(
  index: Partial<Record<CsvImportField, number>>,
): DetectCsvImportTemplateResult {
  if (isLegacyMixedCsvImportHeader(index)) {
    return { status: "legacy" };
  }

  const has = (f: CsvImportField) => index[f] != null;

  const looksLikeB =
    has("openingPacks") || has("costPerPack") || (has("packLabel") && has("packSize") && !has("openingQty"));
  const looksLikeA = has("openingQty") || has("costPrice");

  if (looksLikeB && !TEMPLATE_B_FORBIDDEN.some(has)) {
    const missing = TEMPLATE_B_FIELDS.filter((f) => !has(f));
    if (missing.length === 0) return { status: "ok", kind: "with_packs" };
    return {
      status: "unknown",
      messageKey: "csvImportMissingColumn",
      params: {
        columns: missing
          .map((f) => {
            const labels: Record<CsvImportField, string> = {
              name: CSV_TEMPLATE_B_COLUMNS.name,
              section: CSV_TEMPLATE_B_COLUMNS.section,
              unit: CSV_TEMPLATE_B_COLUMNS.unit,
              packLabel: CSV_TEMPLATE_B_COLUMNS.packLabel,
              packSize: CSV_TEMPLATE_B_COLUMNS.packSize,
              openingPacks: CSV_TEMPLATE_B_COLUMNS.openingPacks,
              costPerPack: CSV_TEMPLATE_B_COLUMNS.costPerPack,
              sellingPrice: CSV_TEMPLATE_B_COLUMNS.sellingPrice,
              openingQty: CSV_TEMPLATE_A_COLUMNS.openingQty,
              costPrice: CSV_TEMPLATE_A_COLUMNS.costPrice,
            };
            return labels[f];
          })
          .join(", "),
      },
    };
  }

  if (looksLikeA && !TEMPLATE_A_FORBIDDEN.some(has)) {
    const missing = TEMPLATE_A_FIELDS.filter((f) => !has(f));
    if (missing.length === 0) return { status: "ok", kind: "no_packs" };
    return {
      status: "unknown",
      messageKey: "csvImportMissingColumn",
      params: {
        columns: missing
          .map((f) => {
            const labels: Partial<Record<CsvImportField, string>> = {
              name: CSV_TEMPLATE_A_COLUMNS.name,
              section: CSV_TEMPLATE_A_COLUMNS.section,
              unit: CSV_TEMPLATE_A_COLUMNS.unit,
              openingQty: CSV_TEMPLATE_A_COLUMNS.openingQty,
              costPrice: CSV_TEMPLATE_A_COLUMNS.costPrice,
              sellingPrice: CSV_TEMPLATE_A_COLUMNS.sellingPrice,
            };
            return labels[f] ?? f;
          })
          .join(", "),
      },
    };
  }

  if (has("name") && !has("sellingPrice")) {
    return {
      status: "unknown",
      messageKey: "csvImportMissingColumn",
      params: { columns: "Selling price" },
    };
  }

  if (has("name") && has("sellingPrice") && !looksLikeA && !looksLikeB) {
    // Minimal name+price only — allow as Template A when no pack-only columns
    // (e.g. ignored internal columns like SKU alongside required fields).
    if (!TEMPLATE_A_FORBIDDEN.some(has)) {
      return { status: "ok", kind: "no_packs" };
    }
  }

  return {
    status: "unknown",
    messageKey: "csvImportUnrecognizedTemplate",
  };
}

export function csvImportTemplateKindLabel(kind: CsvImportTemplateKind): string {
  return kind === "with_packs" ? "With Packs" : "No Packs";
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
