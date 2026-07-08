import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { WIZARD_INPUT_TEXT } from "../wizard/wizardTokens";
import { EditorSection } from "./EditorSection";

type Props = {
  lang: Language;
  sku: string;
  onSkuChange: (value: string) => void;
  canPresets?: boolean;
  moneyPresets: string;
  qtyPresets: string;
  onMoneyPresetsChange: (value: string) => void;
  onQtyPresetsChange: (value: string) => void;
  showBuyPackPrice?: boolean;
  buyPackPrice?: string;
  onBuyPackPriceChange?: (value: string) => void;
  packLabel?: string;
  children?: React.ReactNode;
};

export function EditorAdvancedSection({
  lang,
  sku,
  onSkuChange,
  canPresets,
  moneyPresets,
  qtyPresets,
  onMoneyPresetsChange,
  onQtyPresetsChange,
  showBuyPackPrice,
  buyPackPrice,
  onBuyPackPriceChange,
  packLabel,
  children,
}: Props) {
  return (
    <EditorSection title={t(lang, "stockEditAdvanced")}>
      {children}
      {showBuyPackPrice && onBuyPackPriceChange && packLabel ? (
        <label className="block text-sm font-bold text-foreground">
          {tTemplate(lang, "simpleAddStep8Title", { pack: packLabel })}
          <input
            value={buyPackPrice ?? ""}
            onChange={(e) => onBuyPackPriceChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            className={`${WIZARD_INPUT_TEXT} mt-2`}
          />
        </label>
      ) : null}
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "productSkuOptional")}
        <input value={sku} onChange={(e) => onSkuChange(e.target.value)} className={`${WIZARD_INPUT_TEXT} mt-2`} />
      </label>
      {canPresets ? (
        <>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "tapPricesNote")}
            <input value={moneyPresets} onChange={(e) => onMoneyPresetsChange(e.target.value)} className={`${WIZARD_INPUT_TEXT} mt-2`} />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "tapQtyNote")}
            <input value={qtyPresets} onChange={(e) => onQtyPresetsChange(e.target.value)} className={`${WIZARD_INPUT_TEXT} mt-2`} />
          </label>
        </>
      ) : null}
    </EditorSection>
  );
}
