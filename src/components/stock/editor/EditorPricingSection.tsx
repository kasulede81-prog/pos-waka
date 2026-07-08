import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_INPUT_NUMERIC } from "../wizard/wizardTokens";
import { WizardPricingPanel } from "../wizard/WizardPricingPanel";
import { EditorSection } from "./EditorSection";

type PharmacyUnitPrice = {
  label: string;
  sellPriceUgx: number;
};

type Props = {
  lang: Language;
  pharmacyMode?: boolean;
  unitLabel: string;
  buyPrice: string;
  sellPrice: string;
  onBuyPriceChange: (value: string) => void;
  onSellPriceChange: (value: string) => void;
  unitCostUgx: number;
  sellPriceUgx: number;
  extraUnitPrices?: PharmacyUnitPrice[];
  batchSummary?: string;
  controlledIndicator?: boolean;
};

export function EditorPricingSection({
  lang,
  pharmacyMode,
  unitLabel,
  buyPrice,
  sellPrice,
  onBuyPriceChange,
  onSellPriceChange,
  unitCostUgx,
  sellPriceUgx,
  extraUnitPrices,
  batchSummary,
  controlledIndicator,
}: Props) {
  const labelClass = "block text-sm font-bold text-foreground";

  return (
    <EditorSection title={t(lang, "productEditorSectionPricing")}>
      {pharmacyMode ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block rounded-2xl border border-border/70 bg-muted/30 p-4">
            <span className="text-sm font-black text-foreground">{t(lang, "pharmacyEditBuyPriceLabel")}</span>
            <div className="relative mt-2">
              <input
                value={buyPrice}
                onChange={(e) => onBuyPriceChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                className={clsx(WIZARD_INPUT_NUMERIC, "pr-16 text-2xl")}
                required
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                / {unitLabel}
              </span>
            </div>
          </label>
          <label className="block rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <span className="text-sm font-black text-foreground">{t(lang, "pharmacyEditSellPriceLabel")}</span>
            <div className="relative mt-2">
              <input
                value={sellPrice}
                onChange={(e) => onSellPriceChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                className={clsx(WIZARD_INPUT_NUMERIC, "pr-16 text-2xl")}
                required
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                / {unitLabel}
              </span>
            </div>
          </label>
        </div>
      ) : (
        <>
          <label className={labelClass}>
            {t(lang, "stockEditPriceLabel")}
            <div className="relative mt-2">
              <input
                value={sellPrice}
                onChange={(e) => onSellPriceChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="2000"
                className={clsx(WIZARD_INPUT_NUMERIC, "pr-16")}
                required
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                UGX
              </span>
            </div>
          </label>
        </>
      )}

      {unitCostUgx > 0 && sellPriceUgx > 0 ? (
        <WizardPricingPanel
          lang={lang}
          pharmacyMode={pharmacyMode}
          unitCostUgx={unitCostUgx}
          sellPriceUgx={sellPriceUgx}
          unitLabel={unitLabel}
          extraUnitPrices={extraUnitPrices}
          batchSummary={batchSummary}
          controlledIndicator={controlledIndicator}
        />
      ) : null}
    </EditorSection>
  );
}
