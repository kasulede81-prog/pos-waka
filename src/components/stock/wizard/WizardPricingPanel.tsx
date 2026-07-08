import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { productCostWarningsFromPreview, computeCostValidationPreview } from "../../../lib/costValidation";
import { CostValidationPreview } from "../CostValidationPreview";

type PharmacyUnitPrice = {
  label: string;
  sellPriceUgx: number;
};

type Props = {
  lang: Language;
  unitCostUgx: number;
  sellPriceUgx: number;
  unitLabel: string;
  packCostUgx?: number;
  piecesPerPack?: number;
  packLabel?: string;
  pharmacyMode?: boolean;
  extraUnitPrices?: PharmacyUnitPrice[];
  batchSummary?: string;
  controlledIndicator?: boolean;
  expiryWarning?: string;
};

export function WizardPricingPanel({
  lang,
  unitCostUgx,
  sellPriceUgx,
  unitLabel,
  packCostUgx,
  piecesPerPack,
  packLabel,
  pharmacyMode,
  extraUnitPrices,
  batchSummary,
  controlledIndicator,
  expiryWarning,
}: Props) {
  const preview = computeCostValidationPreview({
    packCostUgx,
    piecesPerPack,
    unitCostUgx,
    sellPriceUgx,
  });
  const warnings = productCostWarningsFromPreview(preview, pharmacyMode);

  return (
    <div className="space-y-3">
      <CostValidationPreview
        lang={lang}
        packCostUgx={packCostUgx}
        piecesPerPack={piecesPerPack}
        unitCostUgx={unitCostUgx}
        sellPriceUgx={sellPriceUgx}
        packLabel={packLabel}
        unitLabel={unitLabel}
      />
      {extraUnitPrices?.map((row) =>
        row.sellPriceUgx > 0 ? (
          <p key={row.label} className="text-sm font-bold text-foreground/80">
            {row.label}: {row.sellPriceUgx.toLocaleString()} UGX
          </p>
        ) : null,
      )}
      {batchSummary ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-950">
          {batchSummary}
        </p>
      ) : null}
      {controlledIndicator ? (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-violet-900">
          {t(lang, "pharmacyRxControlledTitle")}
        </p>
      ) : null}
      {expiryWarning ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          {expiryWarning}
        </p>
      ) : null}
      {pharmacyMode
        ? warnings
            .filter((w) => w.messageKey && !["low_unit_cost", "high_margin"].includes(w.kind))
            .map((w) => (
              <p
                key={w.kind}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950"
              >
                {t(lang, w.messageKey as "pharmacyWarnZeroCost")}
              </p>
            ))
        : null}
    </div>
  );
}
