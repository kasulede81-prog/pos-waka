import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { SELL_UNIT_OPTIONS, type SellUnitKind } from "../../../lib/simpleProductWizard";
import { WIZARD_INPUT_TEXT, wizardChoiceButtonClass } from "../wizard/wizardTokens";

const SELL_UNITS: SellUnitKind[] = ["piece", "bottle", "packet", "kg", "litre", "custom"];

type Props = {
  lang: Language;
  sellUnit: SellUnitKind;
  sellUnitCustom: string;
  onSellUnitChange: (unit: SellUnitKind) => void;
  onSellUnitCustomChange: (value: string) => void;
};

export function RetailUnitSection({ lang, sellUnit, sellUnitCustom, onSellUnitChange, onSellUnitCustomChange }: Props) {
  return (
    <div>
      <span className="text-sm font-bold text-foreground">{t(lang, "stockEditSellUnitLabel")}</span>
      <div className="mt-2 grid grid-cols-2 gap-2.5">
        {SELL_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => onSellUnitChange(u)}
            className={wizardChoiceButtonClass(sellUnit === u)}
          >
            {t(lang, SELL_UNIT_OPTIONS.find((o) => o.id === u)!.labelKey as "sellUnit_piece")}
          </button>
        ))}
      </div>
      {sellUnit === "custom" ? (
        <input
          value={sellUnitCustom}
          onChange={(e) => onSellUnitCustomChange(e.target.value)}
          placeholder={t(lang, "simpleAddSellUnitCustomPh")}
          className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
        />
      ) : null}
    </div>
  );
}
