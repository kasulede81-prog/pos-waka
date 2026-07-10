import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { MEDICINE_FORMS, type MedicineFormPreset } from "../../lib/pharmacyMedicine";
import { WIZARD_INPUT_TEXT } from "./wizard/wizardTokens";

const OTHER_SENTINEL = "Other";

type Props = {
  lang: Language;
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

function isPresetForm(value: string): value is MedicineFormPreset {
  return MEDICINE_FORMS.includes(value as MedicineFormPreset);
}

export function MedicineFormSelect({ lang, value, onChange, className }: Props) {
  const [customActive, setCustomActive] = useState(() => Boolean(value && !isPresetForm(value)));

  useEffect(() => {
    if (value && !isPresetForm(value)) setCustomActive(true);
    else if (isPresetForm(value)) setCustomActive(false);
  }, [value]);

  const preset = customActive ? OTHER_SENTINEL : isPresetForm(value) ? value : "";

  return (
    <div className="space-y-2">
      <select
        value={preset}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER_SENTINEL) {
            setCustomActive(true);
            if (!value || isPresetForm(value)) onChange("");
            return;
          }
          setCustomActive(false);
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
      {customActive ? (
        <input
          value={isPresetForm(value) ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(lang, "pharmacyFormOtherPlaceholder")}
          autoFocus
          className={className ?? clsx(WIZARD_INPUT_TEXT, "mt-2 border-dashed")}
        />
      ) : null}
    </div>
  );
}
