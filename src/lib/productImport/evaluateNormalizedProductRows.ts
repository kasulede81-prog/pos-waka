import type { BusinessType } from "../../types";
import { resolveCatalogSectionInput, type CatalogPickerItem } from "../catalogHierarchy";
import { pharmacyQuickAddRequiresBuyPrice } from "../pharmacyCostIntegrity";
import { defaultWizardUnitCostUgx } from "../simpleProductWizard";
import { isImportCostProvided } from "./createNormalizedRow";
import { applyCategoryResolutionToRow } from "./resolveImportCategory";
import type {
  EvaluatedImportRow,
  ImportRowIssue,
  NormalizedProductImportRow,
} from "./types";

export type EvaluateImportRowsInput = {
  rows: readonly NormalizedProductImportRow[];
  pickerItems?: readonly CatalogPickerItem[];
  existingProductNames?: readonly string[];
  businessType?: BusinessType;
  pharmacyModeEnabled?: boolean | null;
  generalCategoryLabel?: string;
};

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function evaluateNormalizedProductRows(input: EvaluateImportRowsInput): EvaluatedImportRow[] {
  const pickerItems = input.pickerItems ?? [];
  const requireCategory = pickerItems.length > 0;
  const pharmacy = pharmacyQuickAddRequiresBuyPrice(
    input.businessType ?? "kiosk_duka",
    input.pharmacyModeEnabled,
  );
  const existing = new Set((input.existingProductNames ?? []).map(nameKey).filter(Boolean));

  const enabledNameCounts = new Map<string, number>();
  for (const row of input.rows) {
    if (!row.enabled) continue;
    const k = nameKey(row.name);
    if (!k) continue;
    enabledNameCounts.set(k, (enabledNameCounts.get(k) ?? 0) + 1);
  }

  return input.rows.map((row) => {
    const issues: ImportRowIssue[] = [];
    const price = Math.floor(Number(row.sellingPriceUgx) || 0);
    const stock = Number(row.stockQty);
    const costProvided = isImportCostProvided(row);
    const costUnreadable =
      row.costPricePerUnitUgx != null && !Number.isFinite(Number(row.costPricePerUnitUgx));
    const packCostUnreadable =
      row.packMode === "packed" &&
      row.buyingPackCostUgx != null &&
      !Number.isFinite(Number(row.buyingPackCostUgx));
    const costStatus = costProvided ? ("provided" as const) : ("missing_fallback" as const);
    const fallbackCostUgx = price > 0 ? defaultWizardUnitCostUgx(price) : null;

    if (row.enabled && !row.name.trim()) {
      issues.push({ clientId: row.clientId, kind: "missing_name", severity: "error" });
    }
    if (row.enabled && price <= 0) {
      issues.push({ clientId: row.clientId, kind: "invalid_price", severity: "error" });
    }
    if (row.enabled && (!Number.isFinite(stock) || stock < 0)) {
      issues.push({ clientId: row.clientId, kind: "invalid_stock", severity: "error" });
    }

    if (row.enabled && row.packMode === "packed") {
      const rate = Number(row.conversionRate);
      if (!Number.isFinite(rate) || rate <= 1) {
        issues.push({ clientId: row.clientId, kind: "invalid_pack", severity: "error" });
      }
      if (!(row.buyingUnit ?? "").trim()) {
        issues.push({ clientId: row.clientId, kind: "missing_pack_label", severity: "error" });
      }
      const packs = row.openingPacks;
      if (packs != null && (!Number.isFinite(Number(packs)) || Number(packs) < 0)) {
        issues.push({ clientId: row.clientId, kind: "invalid_stock", severity: "error" });
      }
    } else if (row.enabled && row.packMode === "none") {
      // Template A must not silently become packed.
      const rate = row.conversionRate;
      if (rate != null && Number.isFinite(Number(rate)) && Number(rate) > 1) {
        issues.push({ clientId: row.clientId, kind: "invalid_pack", severity: "error" });
      }
    } else if (row.enabled) {
      const rate = row.conversionRate;
      if (rate != null && rate !== undefined) {
        if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) {
          issues.push({ clientId: row.clientId, kind: "invalid_pack", severity: "error" });
        }
      }
    }

    if (row.enabled && (costUnreadable || packCostUnreadable)) {
      issues.push({ clientId: row.clientId, kind: "invalid_cost", severity: "error" });
    } else if (row.enabled && costProvided && Number(row.costPricePerUnitUgx) < 0) {
      issues.push({ clientId: row.clientId, kind: "invalid_cost", severity: "error" });
    }

    const sectionQuery = (row.categoryInput || row.category).trim();
    const section = resolveCatalogSectionInput(pickerItems, sectionQuery);
    if (row.enabled) {
      if (section.status === "ambiguous") {
        issues.push({ clientId: row.clientId, kind: "ambiguous_category", severity: "error" });
      } else if (section.status === "empty" && requireCategory) {
        issues.push({ clientId: row.clientId, kind: "missing_category", severity: "error" });
      } else if (section.status === "unresolved" && sectionQuery) {
        issues.push({ clientId: row.clientId, kind: "unresolved_category", severity: "warning" });
      }
    }

    if (row.enabled && pharmacy && (!Number.isFinite(stock) || stock <= 0)) {
      issues.push({ clientId: row.clientId, kind: "pharmacy_stock_required", severity: "error" });
    }
    if (row.enabled && pharmacy && !costProvided) {
      issues.push({ clientId: row.clientId, kind: "pharmacy_cost_required", severity: "error" });
    } else if (row.enabled && pharmacy && costProvided && Number(row.costPricePerUnitUgx) <= 0) {
      issues.push({ clientId: row.clientId, kind: "pharmacy_cost_required", severity: "error" });
    }

    if (row.enabled && !costProvided && !costUnreadable && !packCostUnreadable && !pharmacy && price > 0) {
      issues.push({ clientId: row.clientId, kind: "cost_fallback", severity: "warning" });
    }

    const nk = nameKey(row.name);
    if (row.enabled && nk && (enabledNameCounts.get(nk) ?? 0) > 1) {
      issues.push({ clientId: row.clientId, kind: "duplicate_name", severity: "error" });
    }
    if (row.enabled && nk && existing.has(nk)) {
      issues.push({ clientId: row.clientId, kind: "duplicate_existing", severity: "warning" });
    }

    if (row.enabled && costProvided && price > 0 && Number(row.costPricePerUnitUgx) > price) {
      issues.push({ clientId: row.clientId, kind: "suspicious_cost_above_sell", severity: "warning" });
    }

    const blocking = issues.some((i) => i.severity === "error");
    const withCategory = applyCategoryResolutionToRow(row, pickerItems);
    return { row: withCategory, costStatus, fallbackCostUgx, issues, blocking };
  });
}

export function importHasBlockingIssues(evaluated: readonly EvaluatedImportRow[]): boolean {
  return evaluated.some((e) => e.row.enabled && e.blocking);
}

export function enabledImportRows(evaluated: readonly EvaluatedImportRow[]): EvaluatedImportRow[] {
  return evaluated.filter((e) => e.row.enabled);
}

export function missingCostFallbackCount(evaluated: readonly EvaluatedImportRow[]): number {
  return evaluated.filter((e) => e.row.enabled && e.costStatus === "missing_fallback" && !e.blocking).length;
}

export type ImportReviewSummary = {
  detected: number;
  ready: number;
  warningRows: number;
  errorRows: number;
  selected: number;
};

export function summarizeImportReview(evaluated: readonly EvaluatedImportRow[]): ImportReviewSummary {
  let ready = 0;
  let warningRows = 0;
  let errorRows = 0;
  let selected = 0;
  for (const e of evaluated) {
    if (!e.row.enabled) continue;
    selected += 1;
    if (e.blocking) {
      errorRows += 1;
      continue;
    }
    ready += 1;
    if (e.issues.some((i) => i.severity === "warning")) warningRows += 1;
  }
  return { detected: evaluated.length, ready, warningRows, errorRows, selected };
}
