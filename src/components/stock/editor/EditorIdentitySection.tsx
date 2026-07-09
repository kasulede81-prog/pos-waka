import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_INPUT_TEXT } from "../wizard/wizardTokens";
import { EditorSection } from "./EditorSection";
import { CategoryShelfPicker } from "../CategoryShelfPicker";
import { MedicineFormSelect } from "../MedicineFormSelect";

type Props = {
  lang: Language;
  nameLabel: string;
  shelfLabel: string;
  name: string;
  category: string;
  categoryPlaceholder?: string;
  categorySuggestions?: string[];
  onNameChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  pharmacyMode?: boolean;
  genericName?: string;
  onGenericNameChange?: (value: string) => void;
  strength?: string;
  onStrengthChange?: (value: string) => void;
  medicineForm?: string;
  onMedicineFormChange?: (value: string) => void;
  strengthLabel?: string;
  formLabel?: string;
};

export function EditorIdentitySection({
  lang,
  nameLabel,
  shelfLabel,
  name,
  category,
  categoryPlaceholder,
  categorySuggestions,
  onNameChange,
  onCategoryChange,
  pharmacyMode,
  genericName,
  onGenericNameChange,
  strength,
  onStrengthChange,
  medicineForm,
  onMedicineFormChange,
  strengthLabel,
  formLabel,
}: Props) {
  const labelClass = "block text-sm font-bold text-foreground";

  return (
    <EditorSection title={t(lang, "productEditorSectionIdentity")}>
      <label className={labelClass}>
        {nameLabel}
        <input value={name} onChange={(e) => onNameChange(e.target.value)} className={clsx(WIZARD_INPUT_TEXT, "mt-2")} required />
      </label>

      <div>
        <p className={labelClass}>{shelfLabel}</p>
        <CategoryShelfPicker
          lang={lang}
          options={categorySuggestions ?? []}
          value={category}
          onChange={onCategoryChange}
          placeholder={categoryPlaceholder}
          inputClass={clsx(WIZARD_INPUT_TEXT, "mt-2")}
        />
      </div>

      {pharmacyMode ? (
        <>
          {onGenericNameChange ? (
            <label className={labelClass}>
              {t(lang, "pharmacyGenericName")}
              <input
                value={genericName ?? ""}
                onChange={(e) => onGenericNameChange(e.target.value)}
                className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
              />
            </label>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              {strengthLabel ?? t(lang, "pharmacyStrengthLabel")}
              <input
                value={strength ?? ""}
                onChange={(e) => onStrengthChange?.(e.target.value)}
                placeholder={t(lang, "pharmacyPlaceholder_strengthExample")}
                className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
              />
            </label>
            <label className={labelClass}>
              {formLabel ?? t(lang, "pharmacyFormLabel")}
              <MedicineFormSelect
                lang={lang}
                value={medicineForm ?? ""}
                onChange={(v) => onMedicineFormChange?.(v)}
              />
            </label>
          </div>
        </>
      ) : null}
    </EditorSection>
  );
}
