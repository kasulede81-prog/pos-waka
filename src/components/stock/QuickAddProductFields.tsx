import type { BusinessType, Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { useWholesaleTerms } from "../../lib/wholesaleTerms";
import { hospitalityUiActive } from "../../lib/hospitalityUx";
import { pharmacyUiActive, uiPlaceholder, wholesaleUiActive } from "../../lib/pharmacyUx";
import { QUICK_ADD_SELL_UNITS } from "../../lib/quickAddProductForm";
import { CategoryShelfPicker } from "./CategoryShelfPicker";

export type QuickAddProductFieldsState = {
  name: string;
  category: string;
  sellUnitPreset: string;
  sellUnitCustom: string;
  price: string;
  stock: string;
  buyPackTotal: string;
};

type Props = {
  lang: Language;
  values: QuickAddProductFieldsState;
  onChange: (patch: Partial<QuickAddProductFieldsState>) => void;
  categorySuggestions?: string[];
  /** Larger inputs for the full-page form; compact for the bottom sheet. */
  variant?: "page" | "sheet";
  businessType?: BusinessType;
  pharmacyModeEnabled?: boolean | null;
  hospitalityModeEnabled?: boolean | null;
};

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <span className="flex items-start gap-2.5">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-waka-600 text-sm font-black text-white"
        aria-hidden
      >
        {n}
      </span>
      <span className="pt-0.5 text-sm font-bold leading-snug text-stone-800">{text}</span>
    </span>
  );
}

export function QuickAddProductFields({
  lang,
  values,
  onChange,
  categorySuggestions = [],
  variant = "page",
  businessType,
  pharmacyModeEnabled,
  hospitalityModeEnabled,
}: Props) {
  const pharmacy = pharmacyUiActive(businessType, pharmacyModeEnabled);
  const wholesale = wholesaleUiActive(businessType);
  const hospitality = hospitalityUiActive(businessType, hospitalityModeEnabled);
  const industryMode = pharmacy || wholesale || hospitality;
  const pt = usePharmacyTerms(lang, businessType, pharmacyModeEnabled);
  const wt = useWholesaleTerms(lang, businessType);
  const inputClass =
    variant === "page"
      ? "mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-lg font-semibold outline-none ring-waka-200 focus:ring"
      : "mt-2 w-full rounded-2xl border-2 border-stone-200 px-4 py-4 text-xl font-semibold";
  const bigInputClass =
    variant === "page"
      ? "mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-2xl font-black outline-none ring-waka-200 focus:ring"
      : "mt-2 w-full rounded-2xl border-2 border-stone-200 px-4 py-4 text-2xl font-black";

  const showOtherUnit = values.sellUnitPreset === "other";
  const unitOptions = wholesale
    ? ["piece", "pack", "other", "crate", "carton", "case", "bundle", "inner pack"]
    : QUICK_ADD_SELL_UNITS;
  const namePlaceholder = industryMode
    ? uiPlaceholder(lang, businessType, "productNamePh", pharmacyModeEnabled, hospitalityModeEnabled)
    : t(lang, "productNamePh");
  const categoryPlaceholder = industryMode
    ? uiPlaceholder(lang, businessType, "quickAddStep2Ph", pharmacyModeEnabled, hospitalityModeEnabled)
    : t(lang, "quickAddStep2Ph");

  return (
    <div className={variant === "page" ? "space-y-5" : "space-y-4"}>
      <label className="block">
        <StepLabel n={1} text={pharmacy ? pt("stockEditName") : wholesale ? wt("stockEditName") : t(lang, "quickAddStep1")} />
        <input
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={namePlaceholder}
          required
          className={inputClass}
          autoFocus={variant === "sheet"}
        />
      </label>

      <div className="block">
        <StepLabel n={2} text={pharmacy ? pt("quickAddStep2") : wholesale ? wt("quickAddStep2") : t(lang, "quickAddStep2")} />
        <div className="mt-2">
          <CategoryShelfPicker
            lang={lang}
            options={categorySuggestions}
            value={values.category}
            onChange={(category) => onChange({ category })}
            placeholder={categoryPlaceholder}
            inputClass={inputClass}
            showHint={categorySuggestions.length > 0}
          />
        </div>
      </div>

      <label className="block">
        <StepLabel n={3} text={t(lang, "quickAddStep3")} />
        <select
          value={values.sellUnitPreset}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ sellUnitPreset: v, sellUnitCustom: v === "other" ? values.sellUnitCustom : "" });
          }}
          className={
            variant === "page"
              ? "mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-base font-bold text-stone-900 outline-none ring-waka-200 focus:ring"
              : "mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 text-base font-bold text-stone-900"
          }
        >
          {unitOptions.map((u) => (
            <option key={u} value={u}>
              {u === "crate" || u === "carton" || u === "case" || u === "bundle" || u === "inner pack"
                ? u
                : t(lang, `sellUnit_${u}`)}
            </option>
          ))}
        </select>
      </label>

      {showOtherUnit ? (
        <label className="block pl-9">
          <span className="text-sm font-bold text-stone-700">{t(lang, "quickAddStep3Other")}</span>
          <input
            value={values.sellUnitCustom}
            onChange={(e) => onChange({ sellUnitCustom: e.target.value })}
            placeholder={t(lang, "unitCustomPlaceholder")}
            className={inputClass}
          />
        </label>
      ) : null}

      <label className="block">
        <StepLabel n={4} text={t(lang, "quickAddStep4")} />
        <input
          value={values.price}
          onChange={(e) => onChange({ price: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          inputMode="numeric"
          placeholder="0"
          required
          className={bigInputClass}
        />
      </label>

      <label className="block">
        <StepLabel n={5} text={t(lang, "quickAddStep5")} />
        <input
          value={values.stock}
          onChange={(e) => onChange({ stock: e.target.value.replace(/[^\d.]/g, "").slice(0, 12) })}
          inputMode="decimal"
          placeholder="0"
          required
          className={bigInputClass}
        />
      </label>

      {!industryMode ? (
        <label className="block rounded-2xl border-2 border-waka-100 bg-waka-50/50 p-4">
          <StepLabel n={6} text={t(lang, "quickAddStep6")} />
          <p className="mt-1 pl-9 text-xs text-stone-600">{t(lang, "quickAddStep6Hint")}</p>
          <input
            value={values.buyPackTotal}
            onChange={(e) => onChange({ buyPackTotal: e.target.value.replace(/\D/g, "").slice(0, 12) })}
            inputMode="numeric"
            placeholder={t(lang, "quickAddStep6Ph")}
            className={`${bigInputClass} pl-9`}
          />
        </label>
      ) : null}
    </div>
  );
}
