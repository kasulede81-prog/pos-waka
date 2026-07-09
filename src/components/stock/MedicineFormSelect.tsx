import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { MEDICINE_FORMS } from "../../lib/pharmacyMedicine";
import { WIZARD_INPUT_TEXT } from "./wizard/wizardTokens";

const OTHER_SENTINEL = "Other";

type Props = {
  lang: Language;
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function MedicineFormSelect({ lang, value, onChange, className }: Props) {
  const preset = MEDICINE_FORMS.includes(value as (typeof MEDICINE_FORMS)[number]) ? value : value ? OTHER_SENTINEL : "";
  const showCustom = preset === OTHER_SENTINEL;

  return (
    <div className="space-y-2">
      <select
        value={preset}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER_SENTINEL) {
            onChange(value && !MEDICINE_FORMS.includes(value as (typeof MEDICINE_FORMS)[number]) ? value : "");
            return;
          }
          onChange(next);
        }}
        className={className ?? clsx(WIZARD_INPUT_TEXT, "mt-2")}
      >
        <option value="">{t(lang, "pharmacyFormSelect")}</option>
        {MEDICINE_FORMS.map((form) => (
          <option key={form} value={form}>
            {form === OTHER_SENTINEL ? t(lang, "categoryOther") : form}
          </option>
        ))}
      </select>
      {showCustom ? (
        <input
          value={value === OTHER_SENTINEL ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(lang, "pharmacyFormOtherPlaceholder")}
          autoFocus
          className={className ?? clsx(WIZARD_INPUT_TEXT, "mt-2 border-dashed")}
        />
      ) : null}
    </div>
  );
}
