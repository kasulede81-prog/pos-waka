import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { shelfGridSpanFromScale, shelfTypographyFromScale } from "../../lib/posShelfLayout";

type Props = {
  lang: Language;
  value: number;
  previewHex: string;
  onChange: (scale: number) => void;
};

export function ShelfScaleSlider({ lang, value, previewHex, onChange }: Props) {
  const { col, row } = shelfGridSpanFromScale(value);
  const typo = shelfTypographyFromScale(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-stone-600">{t(lang, "posShelfEditScale")}</p>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-black tabular-nums text-stone-800">
          {value}%
        </span>
      </div>
      <p className="text-[11px] font-medium text-stone-500">{t(lang, "posShelfScaleHint")}</p>
      <input
        type="range"
        min={25}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-waka-600"
        aria-valuemin={25}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={t(lang, "posShelfEditScale")}
      />
      <div className="flex justify-center pt-1">
        <div
          className={clsx(
            "grid gap-1 rounded-xl border border-stone-200 bg-stone-50 p-2",
            col === 2 ? "w-36 grid-cols-2" : "w-20 grid-cols-1",
          )}
          style={{ gridTemplateRows: `repeat(${row}, minmax(0, 1fr))` }}
          aria-hidden
        >
          <div
            className="flex flex-col justify-center overflow-hidden rounded-lg border shadow-sm"
            style={{
              gridColumn: `span ${col}`,
              gridRow: `span ${row}`,
              minHeight: `${2.4 + row * 1.6}rem`,
              padding: `${typo.paddingRem}rem`,
              background: `linear-gradient(to bottom right, ${previewHex}22, ${previewHex}33)`,
              borderColor: `${previewHex}66`,
            }}
          >
            <span className="font-black leading-tight" style={{ fontSize: `${typo.titleRem}rem` }}>
              Aa
            </span>
            <span className="mt-1 opacity-80" style={{ fontSize: `${typo.iconRem}rem` }} aria-hidden>
              📦
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
