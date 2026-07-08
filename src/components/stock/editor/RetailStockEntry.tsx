import clsx from "clsx";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { WIZARD_INPUT_TEXT } from "../wizard/wizardTokens";

type Props = {
  lang: Language;
  hasPack: boolean;
  piecesPerPack: number;
  packCount: string;
  looseCount: string;
  pieceOnlyStock: string;
  unitLabel: string;
  packLabel: string;
  stockPreview: string;
  onPackCountChange: (value: string) => void;
  onLooseCountChange: (value: string) => void;
  onPieceOnlyStockChange: (value: string) => void;
};

export function RetailStockEntry({
  lang,
  hasPack,
  piecesPerPack,
  packCount,
  looseCount,
  pieceOnlyStock,
  unitLabel,
  packLabel,
  stockPreview,
  onPackCountChange,
  onLooseCountChange,
  onPieceOnlyStockChange,
}: Props) {
  return (
    <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
      <span className="text-sm font-bold text-foreground">{t(lang, "stockEditStockLabel")}</span>
      {hasPack && piecesPerPack > 1 ? (
        <div className="mt-2 space-y-3">
          <label className="block text-sm font-semibold text-foreground/80">
            {tTemplate(lang, "simpleAddStep6TitlePack", { pack: packLabel })}
            <input
              value={packCount}
              onChange={(e) => onPackCountChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
              inputMode="decimal"
              className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
            />
          </label>
          <label className="block text-sm font-semibold text-foreground/80">
            {tTemplate(lang, "stockEditLooseLabel", { unit: unitLabel })}
            <input
              value={looseCount}
              onChange={(e) => onLooseCountChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
              inputMode="decimal"
              placeholder="0"
              className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
            />
          </label>
        </div>
      ) : (
        <input
          value={pieceOnlyStock}
          onChange={(e) => onPieceOnlyStockChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 10))}
          inputMode="decimal"
          className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
        />
      )}
      <p className="mt-3 rounded-xl border border-border/60 bg-card px-3 py-2 text-sm font-black text-primary">
        {stockPreview}
      </p>
    </div>
  );
}
