import clsx from "clsx";
import type { BusinessType, Language } from "../../types";
import type { CatalogPickerItem } from "../../lib/catalogHierarchy";
import { catalogItemPathText } from "../../lib/catalogHierarchy";
import { t } from "../../lib/i18n";
import {
  evaluateNormalizedProductRows,
  importHasBlockingIssues,
  missingCostFallbackCount,
} from "../../lib/productImport/evaluateNormalizedProductRows";
import { applyCategoryResolutionToRow } from "../../lib/productImport/resolveImportCategory";
import { isImportCostProvided } from "../../lib/productImport/createNormalizedRow";
import type {
  ImportRowIssueKind,
  NormalizedProductImportRow,
} from "../../lib/productImport/types";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

const ISSUE_I18N: Record<ImportRowIssueKind, string> = {
  missing_name: "importIssueMissingName",
  invalid_price: "importIssueInvalidPrice",
  invalid_stock: "importIssueInvalidStock",
  invalid_cost: "importIssueInvalidCost",
  invalid_pack: "importIssueInvalidPack",
  missing_category: "importIssueMissingCategory",
  ambiguous_category: "importIssueAmbiguousCategory",
  unresolved_category: "importIssueUnresolvedCategory",
  duplicate_name: "importIssueDuplicateName",
  duplicate_existing: "importIssueDuplicateExisting",
  cost_fallback: "importIssueCostFallback",
  suspicious_cost_above_sell: "importIssueCostAboveSell",
  pharmacy_stock_required: "importIssuePharmacyStock",
  pharmacy_cost_required: "importIssuePharmacyCost",
};

const INPUT =
  "w-full min-w-0 rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-semibold text-foreground";

type Props = {
  lang: Language;
  rows: NormalizedProductImportRow[];
  onChange: (rows: NormalizedProductImportRow[]) => void;
  pickerItems: readonly CatalogPickerItem[];
  existingProductNames?: readonly string[];
  businessType?: BusinessType;
  pharmacyModeEnabled?: boolean | null;
  generalCategoryLabel?: string;
};

function patchRow(
  rows: NormalizedProductImportRow[],
  clientId: string,
  patch: Partial<NormalizedProductImportRow>,
): NormalizedProductImportRow[] {
  return rows.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row));
}

export function ProductImportReviewTable({
  lang,
  rows,
  onChange,
  pickerItems,
  existingProductNames,
  businessType,
  pharmacyModeEnabled,
  generalCategoryLabel,
}: Props) {
  const evaluated = evaluateNormalizedProductRows({
    rows,
    pickerItems,
    existingProductNames,
    businessType,
    pharmacyModeEnabled,
    generalCategoryLabel,
  });

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-muted text-xs font-bold uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-2">✓</th>
            <th className="px-2 py-2">{t(lang, "stockEditNameLabel")}</th>
            <th className="px-2 py-2">{t(lang, "importColSection")}</th>
            <th className="px-2 py-2">{t(lang, "importColUnit")}</th>
            <th className="px-2 py-2">{t(lang, "importColPack")}</th>
            <th className="px-2 py-2">{t(lang, "stockEditStockLabel")}</th>
            <th className="px-2 py-2">{t(lang, "importColCost")}</th>
            <th className="px-2 py-2">{t(lang, "stockEditPriceLabel")}</th>
          </tr>
        </thead>
        <tbody>
          {evaluated.map(({ row, issues, costStatus, fallbackCostUgx, blocking }) => {
            const sectionMatches = issues.filter((i) => i.kind === "ambiguous_category");
            const resolvedHint =
              row.category && !sectionMatches.length
                ? pickerItems.find((i) => i.legacyShelfKey === row.category)
                : undefined;
            return (
              <tr
                key={row.clientId}
                className={clsx("border-t border-border align-top", blocking && row.enabled && "bg-warning-muted/30")}
              >
                <td className="px-2 py-2">
                  <WakaCheckbox
                    checked={row.enabled}
                    onCheckedChange={(checked) => onChange(patchRow(rows, row.clientId, { enabled: checked }))}
                    row={false}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={row.name}
                    onChange={(e) => onChange(patchRow(rows, row.clientId, { name: e.target.value }))}
                    className={clsx(INPUT, "min-w-[120px]")}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={row.categoryInput}
                    onChange={(e) => {
                      const categoryInput = e.target.value;
                      const next = applyCategoryResolutionToRow(
                        { ...row, categoryInput },
                        pickerItems,
                      );
                      onChange(patchRow(rows, row.clientId, { categoryInput, category: next.category }));
                    }}
                    className={clsx(INPUT, "min-w-[110px]")}
                  />
                  {resolvedHint ? (
                    <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{catalogItemPathText(resolvedHint)}</p>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  <input
                    value={row.baseUnit}
                    onChange={(e) => onChange(patchRow(rows, row.clientId, { baseUnit: e.target.value }))}
                    className={clsx(INPUT, "w-20")}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={row.conversionRate != null ? String(row.conversionRate) : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.]/g, "");
                      onChange(
                        patchRow(rows, row.clientId, {
                          conversionRate: raw === "" ? null : Number(raw),
                        }),
                      );
                    }}
                    inputMode="numeric"
                    className={clsx(INPUT, "w-16")}
                    placeholder="—"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={String(row.stockQty)}
                    onChange={(e) =>
                      onChange(
                        patchRow(rows, row.clientId, {
                          stockQty: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0),
                        }),
                      )
                    }
                    inputMode="decimal"
                    className={clsx(INPUT, "w-16")}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    value={isImportCostProvided(row) ? String(Math.floor(Number(row.costPricePerUnitUgx))) : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      onChange(
                        patchRow(rows, row.clientId, {
                          costPricePerUnitUgx: raw === "" ? null : Math.floor(Number(raw)),
                        }),
                      );
                    }}
                    inputMode="numeric"
                    className={clsx(INPUT, "w-24")}
                    placeholder={costStatus === "missing_fallback" && fallbackCostUgx != null ? String(fallbackCostUgx) : ""}
                    aria-label={t(lang, "importColCost")}
                  />
                  {costStatus === "missing_fallback" && !issues.some((i) => i.kind === "invalid_cost") ? (
                    <p className="mt-1 text-[11px] font-bold text-warning">{t(lang, "importCostFallbackHint")}</p>
                  ) : isImportCostProvided(row) ? (
                    <p className="mt-1 text-[11px] font-bold text-success">{t(lang, "importCostProvidedHint")}</p>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  <input
                    value={String(row.sellingPriceUgx)}
                    onChange={(e) =>
                      onChange(
                        patchRow(rows, row.clientId, {
                          sellingPriceUgx: Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0),
                        }),
                      )
                    }
                    inputMode="numeric"
                    className={clsx(INPUT, "w-24")}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {evaluated.map(({ row, issues }) =>
        row.enabled && issues.length ? (
          <ul key={`issues-${row.clientId}`} className="border-t border-border px-3 py-2 text-xs font-semibold">
            {issues.map((issue) => (
              <li
                key={`${row.clientId}-${issue.kind}`}
                className={issue.severity === "error" ? "text-destructive" : "text-warning"}
              >
                {row.sourceRowNumber != null ? `Row ${row.sourceRowNumber} — ` : ""}
                {row.name.trim() || "—"}: {t(lang, ISSUE_I18N[issue.kind])}
              </li>
            ))}
          </ul>
        ) : null,
      )}
    </div>
  );
}

export function productImportReviewCanCommit(
  rows: NormalizedProductImportRow[],
  extras: Omit<Parameters<typeof evaluateNormalizedProductRows>[0], "rows">,
): { canCommit: boolean; fallbackCount: number } {
  const evaluated = evaluateNormalizedProductRows({ rows, ...extras });
  return {
    canCommit: !importHasBlockingIssues(evaluated) && evaluated.some((e) => e.row.enabled),
    fallbackCount: missingCostFallbackCount(evaluated),
  };
}
