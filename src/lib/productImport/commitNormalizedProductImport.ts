import {
  evaluateNormalizedProductRows,
  importHasBlockingIssues,
  type EvaluateImportRowsInput,
} from "./evaluateNormalizedProductRows";
import { mapNormalizedRowsToBulkQuickAdd } from "./mapNormalizedRowsToBulkQuickAdd";
import type { BulkQuickAddProductRow, EvaluatedImportRow, NormalizedProductImportRow } from "./types";

export type BulkQuickAddFn = (rows: BulkQuickAddProductRow[]) => { added: number; skipped: number };

export type CommitNormalizedProductImportInput = EvaluateImportRowsInput & {
  rows: readonly NormalizedProductImportRow[];
  bulkQuickAddProducts: BulkQuickAddFn;
};

export type CommitNormalizedProductImportResult = {
  ok: boolean;
  added: number;
  skipped: number;
  blocked: boolean;
  evaluated: EvaluatedImportRow[];
};

/**
 * Review-time gate then the existing bulk create engine.
 * Never writes `public.products` itself.
 */
export function commitNormalizedProductImport(
  input: CommitNormalizedProductImportInput,
): CommitNormalizedProductImportResult {
  const evaluated = evaluateNormalizedProductRows(input);
  if (importHasBlockingIssues(evaluated)) {
    return { ok: false, added: 0, skipped: 0, blocked: true, evaluated };
  }

  const payload = mapNormalizedRowsToBulkQuickAdd(
    evaluated.filter((e) => e.row.enabled).map((e) => e.row),
    {
      pickerItems: input.pickerItems,
      generalCategoryLabel: input.generalCategoryLabel,
    },
  );

  if (payload.length === 0) {
    return { ok: false, added: 0, skipped: 0, blocked: true, evaluated };
  }

  const result = input.bulkQuickAddProducts(payload);
  return {
    ok: result.added > 0,
    added: result.added,
    skipped: result.skipped,
    blocked: false,
    evaluated,
  };
}
