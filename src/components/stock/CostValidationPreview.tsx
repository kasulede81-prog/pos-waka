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

  return (
    <div className={`space-y-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 ${textClass}`}>
      {preview.packCostUgx != null && preview.piecesPerPack != null ? (
        <>
          <p className="font-semibold text-slate-700">
            {tTemplate(lang, "costPreviewPackCost", {
              pack: packLabel,
              amount: preview.packCostUgx.toLocaleString(),
            })}
          </p>
          <p className="font-semibold text-slate-700">
            {tTemplate(lang, "costPreviewPieces", { count: String(preview.piecesPerPack) })}
          </p>
        </>
      ) : null}
      {preview.unitCostUgx != null ? (
        <p className="font-bold text-slate-900">
          {tTemplate(lang, "costPreviewUnitCost", {
            unit: unitLabel,
            amount: preview.unitCostUgx.toLocaleString(),
          })}
        </p>
      ) : null}
      {preview.sellPriceUgx != null ? (
        <p className="font-bold text-slate-900">
          {tTemplate(lang, "costPreviewSellPrice", {
            unit: unitLabel,
            amount: preview.sellPriceUgx.toLocaleString(),
          })}
        </p>
      ) : null}
      {preview.profitPerUnitUgx != null ? (
        <p
          className={
            preview.profitPerUnitUgx >= 0 ? "font-black text-emerald-800" : "font-black text-rose-800"
          }
        >
          {tTemplate(lang, "costPreviewProfit", {
            unit: unitLabel,
            amount: preview.profitPerUnitUgx.toLocaleString(),
          })}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-950">
          <p className="font-black">{t(lang, "costPreviewWarningTitle")}</p>
          <p className="mt-0.5 font-semibold">{t(lang, "costPreviewWarningBody")}</p>
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
