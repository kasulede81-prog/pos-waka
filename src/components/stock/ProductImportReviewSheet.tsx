import { useMemo } from "react";
import type { BusinessType, Language } from "../../types";
import type { CatalogPickerItem } from "../../lib/catalogHierarchy";
import { t, tTemplate } from "../../lib/i18n";
import { commitNormalizedProductImport } from "../../lib/productImport/commitNormalizedProductImport";
import type { BulkQuickAddFn } from "../../lib/productImport/commitNormalizedProductImport";
import { evaluateNormalizedProductRows, summarizeImportReview } from "../../lib/productImport/evaluateNormalizedProductRows";
import type { HeaderMappingDecision } from "../../lib/productImport/headerMappingConfidence";
import type { CsvImportField } from "../../lib/productImport/csvColumns";
import type { NormalizedProductImportRow } from "../../lib/productImport/types";
import { ModalSheet } from "../layout/ModalSheet";
import { WakaButton } from "../ui/wakaPrimitives";
import { ProductImportReviewTable, productImportReviewCanCommit } from "./ProductImportReviewTable";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  rows: NormalizedProductImportRow[];
  onChange: (rows: NormalizedProductImportRow[]) => void;
  /** Phase 6 — per-column mapping confidence for the imported sheet (optional; empty for manual/AI rows). */
  headerMappings?: readonly HeaderMappingDecision[];
  pickerItems: readonly CatalogPickerItem[];
  existingProductNames?: readonly string[];
  businessType?: BusinessType;
  pharmacyModeEnabled?: boolean | null;
  generalCategoryLabel?: string;
  bulkQuickAddProducts: BulkQuickAddFn;
  onImported?: (result: {
    added: number;
    skipped: number;
    skippedReason?: "planProductLimit";
  }) => void;
};

const FIELD_LABEL_KEY: Record<CsvImportField, string> = {
  name: "importFieldLabelName",
  section: "importFieldLabelSection",
  unit: "importFieldLabelUnit",
  openingQty: "importFieldLabelOpeningStock",
  openingPacks: "importFieldLabelOpeningStockPacks",
  costPrice: "importFieldLabelCostPrice",
  costPerPack: "importFieldLabelCostPerPack",
  sellingPrice: "importFieldLabelSellingPrice",
  packLabel: "importFieldLabelPack",
  packSize: "importFieldLabelPackSize",
};

export function ProductImportReviewSheet({
  lang,
  open,
  onClose,
  rows,
  onChange,
  headerMappings,
  pickerItems,
  existingProductNames,
  businessType,
  pharmacyModeEnabled,
  generalCategoryLabel,
  bulkQuickAddProducts,
  onImported,
}: Props) {
  const extras = useMemo(
    () => ({
      pickerItems,
      existingProductNames,
      businessType,
      pharmacyModeEnabled,
      generalCategoryLabel,
      headerMappings,
    }),
    [pickerItems, existingProductNames, businessType, pharmacyModeEnabled, generalCategoryLabel, headerMappings],
  );
  const { canCommit, fallbackCount } = productImportReviewCanCommit(rows, extras);
  const summary = useMemo(
    () => summarizeImportReview(evaluateNormalizedProductRows({ rows, ...extras })),
    [rows, extras],
  );

  const handleImport = () => {
    if (fallbackCount > 0) {
      const ok = window.confirm(tTemplate(lang, "importCostFallbackConfirm", { count: String(fallbackCount) }));
      if (!ok) return;
    }
    const result = commitNormalizedProductImport({
      rows,
      bulkQuickAddProducts,
      ...extras,
    });
    if (result.blocked) return;
    onImported?.({
      added: result.added,
      skipped: result.skipped,
      ...(result.skippedReason ? { skippedReason: result.skippedReason } : {}),
    });
    if (result.added > 0) onClose();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      zIndexClass="z-[59]"
      panelClassName="!max-w-5xl"
      title={t(lang, "importReviewTitle")}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <WakaButton type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
          <WakaButton type="button" className="flex-1" disabled={!canCommit} onClick={handleImport}>
            {summary.ready > 0
              ? tTemplate(lang, "importReviewConfirmCount", { count: String(summary.ready) })
              : t(lang, "importReviewConfirm")}
          </WakaButton>
        </div>
      }
    >
      <p className="mb-1 text-base font-black text-foreground">
        {tTemplate(lang, "importSummaryFound", { count: String(summary.detected) })}
      </p>
      <p className="mb-3 text-sm font-semibold text-muted-foreground">{t(lang, "importReviewSub")}</p>
      <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-2xl border border-border bg-muted/60 px-3 py-2">
          <dt className="text-[11px] font-bold uppercase text-muted-foreground">{t(lang, "importSummaryDetected")}</dt>
          <dd className="text-lg font-black text-foreground">{summary.detected}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 px-3 py-2">
          <dt className="text-[11px] font-bold uppercase text-muted-foreground">{t(lang, "importSummaryReady")}</dt>
          <dd className="text-lg font-black text-foreground">{summary.ready}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 px-3 py-2">
          <dt className="text-[11px] font-bold uppercase text-muted-foreground">{t(lang, "importSummaryWarnings")}</dt>
          <dd className="text-lg font-black text-warning">{summary.warningRows}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 px-3 py-2">
          <dt className="text-[11px] font-bold uppercase text-muted-foreground">{t(lang, "importSummaryErrors")}</dt>
          <dd className="text-lg font-black text-destructive">{summary.errorRows}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 px-3 py-2">
          <dt className="text-[11px] font-bold uppercase text-muted-foreground">
            {t(lang, "importSummaryDuplicates")}
          </dt>
          <dd className="text-lg font-black text-warning">{summary.duplicateRows}</dd>
        </div>
      </dl>
      {summary.errorRows > 0 ? (
        <p className="mb-3 text-sm font-bold text-destructive">{t(lang, "importSummaryFixErrors")}</p>
      ) : null}
      {fallbackCount > 0 ? (
        <p className="mb-3 rounded-2xl bg-warning-muted px-3 py-2 text-sm font-bold text-warning-foreground">
          {tTemplate(lang, "importCostFallbackBanner", { count: String(fallbackCount) })}
        </p>
      ) : null}
      {headerMappings?.length ? (
        <div className="mb-3 rounded-2xl border border-border bg-muted/50 px-3 py-3">
          <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
            {t(lang, "importMappingTitle")}
          </p>
          <ul className="space-y-1.5">
            {headerMappings.map((decision, i) => {
              const fieldLabel = decision.canonicalField ? t(lang, FIELD_LABEL_KEY[decision.canonicalField]) : null;
              const icon = decision.confidence === "high" ? "✓" : "⚠";
              const tone =
                decision.confidence === "high"
                  ? "text-foreground"
                  : decision.confidence === "medium"
                    ? "text-warning-foreground"
                    : "text-destructive";
              return (
                <li key={`${decision.sourceHeader}-${i}`} className={`text-sm font-semibold ${tone}`}>
                  <span className="font-black">{decision.sourceHeader}</span>
                  {" → "}
                  {fieldLabel ? (
                    <>
                      {fieldLabel} <span aria-hidden>{icon}</span>
                    </>
                  ) : (
                    <span>{t(lang, "importMappingNotSafelyMapped")}</span>
                  )}
                  {decision.reason === "competing_columns" ? (
                    <span className="ml-1 text-xs font-bold">({t(lang, "importMappingReviewRecommended")})</span>
                  ) : null}
                  {decision.reason === "generic_term" ? (
                    <span className="ml-1 text-xs font-bold">({t(lang, "importMappingReviewRecommended")})</span>
                  ) : null}
                  {decision.reason === "pack_price_conflict" ? (
                    <span className="ml-1 text-xs font-bold">({t(lang, "importMappingActionRequired")})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <ProductImportReviewTable
        lang={lang}
        rows={rows}
        onChange={onChange}
        pickerItems={pickerItems}
        existingProductNames={existingProductNames}
        businessType={businessType}
        pharmacyModeEnabled={pharmacyModeEnabled}
        generalCategoryLabel={generalCategoryLabel}
      />
    </ModalSheet>
  );
}
