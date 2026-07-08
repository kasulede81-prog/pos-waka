import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { ADJUST_FIELD_LABEL, WIZARD_INPUT_NUMERIC, WIZARD_INPUT_TEXT } from "./adjustmentTokens";
import { AdjustmentHeader } from "./AdjustmentHeader";

type Props = {
  lang: Language;
  quantity: string;
  onQuantityChange: (value: string) => void;
  note?: string;
  onNoteChange?: (value: string) => void;
  showDirection?: boolean;
  direction?: "in" | "out";
  onDirectionChange?: (dir: "in" | "out") => void;
  unitLabel?: string;
};

export function AdjustmentQuantityEditor({
  lang,
  quantity,
  onQuantityChange,
  note,
  onNoteChange,
  showDirection,
  direction = "out",
  onDirectionChange,
  unitLabel,
}: Props) {
  return (
    <section className="space-y-3">
      <AdjustmentHeader title={t(lang, "adjQuantityTitle")} />

      {showDirection && onDirectionChange ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onDirectionChange("in")}
            className={`min-h-[48px] rounded-2xl border-2 text-sm font-black ${
              direction === "in" ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card"
            }`}
          >
            {t(lang, "adjDirectionIn")}
          </button>
          <button
            type="button"
            onClick={() => onDirectionChange("out")}
            className={`min-h-[48px] rounded-2xl border-2 text-sm font-black ${
              direction === "out" ? "border-rose-500 bg-rose-600 text-white" : "border-border bg-card"
            }`}
          >
            {t(lang, "adjDirectionOut")}
          </button>
        </div>
      ) : null}

      <label className="block">
        <span className={ADJUST_FIELD_LABEL}>
          {unitLabel ? t(lang, "adjQuantityWithUnit").replace("{{unit}}", unitLabel) : t(lang, "adjQuantityLabel")}
        </span>
        <input
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          className={`${WIZARD_INPUT_NUMERIC} mt-2`}
        />
      </label>

      {onNoteChange ? (
        <label className="block">
          <span className={ADJUST_FIELD_LABEL}>{t(lang, "adjNoteLabel")}</span>
          <input
            value={note ?? ""}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t(lang, "adjNotePh")}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
      ) : null}
    </section>
  );
}
