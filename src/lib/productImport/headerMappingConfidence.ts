/**
 * Phase 4 — smart header mapping confidence.
 *
 * This is a PRESENTATIONAL + VALIDATION-INPUT analyzer only. It never decides
 * which column feeds `stockQty` / `costPricePerUnitUgx` / `sellingPriceUgx` —
 * `mapCsvImportHeaderRow` (csvColumns.ts) still does that, unchanged, and
 * remains the single source of truth for the actual mapping used to build
 * normalized rows. This module answers a different question: "how much
 * should the operator trust what we picked?" — for review-UI transparency
 * (Phase 6) and for the blocking safety checks in `evaluateNormalizedProductRows`
 * (Phase 7).
 *
 * Because `csvImportFieldFromHeader` matches by exact normalized string, a
 * header like "Selling Price per Carton" already fails to match the
 * `sellingPrice` alias list today — it is structurally impossible for it to
 * silently become a unit price. What was missing is explaining that to the
 * operator instead of just dropping the column. That is what `pack_price_conflict`
 * is for.
 */
import {
  csvImportFieldFromHeader,
  isIgnoredInternalCsvHeader,
  normalizeHeader,
  type CsvImportField,
} from "./csvColumns";

export type HeaderMappingConfidence = "high" | "medium" | "low";

export type HeaderMappingReason = "generic_term" | "competing_columns" | "pack_price_conflict";

export type HeaderMappingDecision = {
  sourceHeader: string;
  /** Null when the header could not be matched to any canonical field at all. */
  canonicalField: CsvImportField | null;
  confidence: HeaderMappingConfidence;
  reason?: HeaderMappingReason;
};

/** A price/cost header referencing one of these words is describing a PACK price, not a unit price. */
const CARDINALITY_WORDS = [
  "carton",
  "box",
  "crate",
  "dozen",
  "case",
  "pack",
  "bag",
  "sack",
  "tray",
  "package",
];

const PRICE_WORDS = ["price", "cost"];

/** Bare, otherwise-unqualified terms that are inherently ambiguous even though WAKA maps them. */
const GENERIC_EXACT: Partial<Record<CsvImportField, string>> = {
  sellingPrice: "price",
  costPrice: "cost",
};

/** The only two canonical fields that must always mean "per sell unit". */
const UNIT_PRICE_FIELDS: readonly CsvImportField[] = ["sellingPrice", "costPrice"];

function hasWord(normalized: string, words: readonly string[]): boolean {
  const tokens = normalized.split(" ");
  return words.some((w) => tokens.includes(w));
}

/**
 * Score every column in a header row for mapping confidence.
 * Read-only: does not mutate anything and has no effect on which column
 * `mapCsvImportHeaderRow` selects for a given field.
 */
export function analyzeHeaderMappings(headerRow: readonly string[]): HeaderMappingDecision[] {
  const decisions: HeaderMappingDecision[] = [];
  const parsed: Array<{ header: string; field: CsvImportField | null; normalized: string }> = [];
  const fieldCounts = new Map<CsvImportField, number>();

  for (const raw of headerRow) {
    const header = (raw ?? "").trim();
    if (!header || isIgnoredInternalCsvHeader(header)) continue;
    const field = csvImportFieldFromHeader(header);
    const normalized = normalizeHeader(header);
    parsed.push({ header, field, normalized });
    if (field) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
  }

  for (const { header, field, normalized } of parsed) {
    if (!field) {
      // Unmapped column. Flag only the specific unsafe case: it reads like a
      // price/cost concept qualified by a pack unit, so silently ignoring it
      // would be confusing ("why didn't my price column show up?").
      if (hasWord(normalized, PRICE_WORDS) && hasWord(normalized, CARDINALITY_WORDS)) {
        decisions.push({ sourceHeader: header, canonicalField: null, confidence: "low", reason: "pack_price_conflict" });
      }
      continue;
    }

    const isUnitPriceField = UNIT_PRICE_FIELDS.includes(field);
    if (isUnitPriceField && hasWord(normalized, CARDINALITY_WORDS)) {
      // e.g. a header matched "cost" loosely but also says "per carton" — do
      // not let the review screen present this as a confident unit price.
      decisions.push({ sourceHeader: header, canonicalField: field, confidence: "low", reason: "pack_price_conflict" });
      continue;
    }

    if ((fieldCounts.get(field) ?? 0) > 1) {
      decisions.push({ sourceHeader: header, canonicalField: field, confidence: "medium", reason: "competing_columns" });
      continue;
    }

    if (GENERIC_EXACT[field] === normalized) {
      decisions.push({ sourceHeader: header, canonicalField: field, confidence: "medium", reason: "generic_term" });
      continue;
    }

    decisions.push({ sourceHeader: header, canonicalField: field, confidence: "high" });
  }

  return decisions;
}

export function hasPackPriceConflict(decisions: readonly HeaderMappingDecision[]): boolean {
  return decisions.some((d) => d.reason === "pack_price_conflict");
}

export function hasCompetingColumns(decisions: readonly HeaderMappingDecision[]): boolean {
  return decisions.some((d) => d.reason === "competing_columns");
}

export function hasGenericTerm(decisions: readonly HeaderMappingDecision[]): boolean {
  return decisions.some((d) => d.reason === "generic_term");
}
