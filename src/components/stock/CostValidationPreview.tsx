import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  computeCostValidationPreview,
  getCostValidationWarnings,
  type CostValidationPreview,
} from "../../lib/costValidation";

type Props = {
  lang: Language;
  packCostUgx?: number;
  piecesPerPack?: number;
  unitCostUgx?: number;
  sellPriceUgx?: number;
  packLabel?: string;
  unitLabel?: string;
  compact?: boolean;
};

function PreviewBlock({
  lang,
  preview,
  packLabel,
  unitLabel,
  compact,
}: {
  lang: Language;
  preview: CostValidationPreview;
  packLabel: string;
  unitLabel: string;
  compact?: boolean;
}) {
  const warnings = getCostValidationWarnings(preview);
  const textClass = compact ? "text-xs" : "text-sm";
  const profitPositive = (preview.profitPerUnitUgx ?? 0) >= 0;

  return (
    <div
      className={`space-y-2.5 rounded-2xl border border-border/70 bg-muted/40 px-4 py-3.5 shadow-sm backdrop-blur-sm ${textClass}`}
    >
      {preview.packCostUgx != null && preview.piecesPerPack != null ? (
        <>
          <p className="font-semibold text-muted-foreground">
            {tTemplate(lang, "costPreviewPackCost", {
              pack: packLabel,
              amount: preview.packCostUgx.toLocaleString(),
            })}
          </p>
          <p className="font-semibold text-muted-foreground">
            {tTemplate(lang, "costPreviewPieces", { count: String(preview.piecesPerPack) })}
          </p>
        </>
      ) : null}
      {preview.unitCostUgx != null ? (
        <p className="font-bold text-foreground">
          {tTemplate(lang, "costPreviewUnitCost", {
            unit: unitLabel,
            amount: preview.unitCostUgx.toLocaleString(),
          })}
        </p>
      ) : null}
      {preview.sellPriceUgx != null ? (
        <p className="font-bold text-foreground">
          {tTemplate(lang, "costPreviewSellPrice", {
            unit: unitLabel,
            amount: preview.sellPriceUgx.toLocaleString(),
          })}
        </p>
      ) : null}
      {preview.profitPerUnitUgx != null ? (
        <p className={profitPositive ? "font-black text-emerald-700 dark:text-emerald-400" : "font-black text-rose-700 dark:text-rose-400"}>
          {tTemplate(lang, "costPreviewProfit", {
            unit: unitLabel,
            amount: preview.profitPerUnitUgx.toLocaleString(),
          })}
        </p>
      ) : null}
      {preview.marginPct != null ? (
        <p className="font-bold text-foreground/80">
          {tTemplate(lang, "costPreviewMargin", { pct: String(preview.marginPct) })}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100">
          <p className="font-black">{t(lang, "costPreviewWarningTitle")}</p>
          <p className="mt-0.5 font-semibold opacity-90">{t(lang, "costPreviewWarningBody")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function CostValidationPreview({
  lang,
  packCostUgx,
  piecesPerPack,
  unitCostUgx,
  sellPriceUgx,
  packLabel = "",
  unitLabel = "",
  compact,
}: Props) {
  const preview = computeCostValidationPreview({
    packCostUgx,
    piecesPerPack,
    unitCostUgx,
    sellPriceUgx,
  });

  const hasPackInputs = preview.packCostUgx != null && preview.piecesPerPack != null;
  const hasDirectCost = unitCostUgx != null && unitCostUgx >= 0 && !hasPackInputs;
  const hasSell = preview.sellPriceUgx != null;

  if (!hasSell || (!hasPackInputs && !hasDirectCost)) {
    return null;
  }

  return (
    <PreviewBlock
      lang={lang}
      preview={preview}
      packLabel={packLabel}
      unitLabel={unitLabel}
      compact={compact}
    />
  );
}
