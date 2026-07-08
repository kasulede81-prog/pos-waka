import clsx from "clsx";
import type { Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { WIZARD_INPUT_TEXT } from "../wizard/wizardTokens";
import { PharmacyBatchIntegrityBanner } from "../../pharmacy/PharmacyBatchIntegrityBanner";
import { EditorSection } from "./EditorSection";
import type { PharmacyPackagingFieldState } from "../PharmacyPackagingFields";

type Props = {
  lang: Language;
  pharmacyMode?: boolean;
  product: Product;
  minAlert: string;
  onMinAlertChange: (value: string) => void;
  lowStockLabel: string;
  expiryDate?: string;
  onExpiryDateChange?: (value: string) => void;
  packagingEdit?: boolean;
  packagingState?: PharmacyPackagingFieldState;
  onLowStockUnitChange?: (unit: PharmacyPackagingFieldState["lowStockUnit"]) => void;
  stockSummary?: React.ReactNode;
  children?: React.ReactNode;
};

export function EditorInventorySection({
  lang,
  pharmacyMode,
  product,
  minAlert,
  onMinAlertChange,
  lowStockLabel,
  expiryDate,
  onExpiryDateChange,
  packagingEdit,
  packagingState,
  onLowStockUnitChange,
  stockSummary,
  children,
}: Props) {
  const labelClass = "block text-sm font-bold text-foreground";

  return (
    <EditorSection title={t(lang, "productEditorSectionInventory")}>
      {children}

      {pharmacyMode && onExpiryDateChange ? (
        <label className={labelClass}>
          {t(lang, "pharmacyExpiryDateLabel")}
          <input
            type="date"
            value={expiryDate ?? ""}
            onChange={(e) => onExpiryDateChange(e.target.value)}
            className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
          />
          <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "pharmacyExpiryDateHint")}</p>
        </label>
      ) : null}

      {stockSummary}

      <label className={labelClass}>
        {lowStockLabel}
        <div className={packagingEdit && packagingState?.enabled ? "mt-2 flex gap-2" : "mt-2"}>
          <input
            value={minAlert}
            onChange={(e) => onMinAlertChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            placeholder="10"
            className={clsx(WIZARD_INPUT_TEXT, packagingEdit && packagingState?.enabled ? "flex-1" : "")}
          />
          {packagingEdit && packagingState?.enabled && onLowStockUnitChange ? (
            <select
              value={packagingState.lowStockUnit}
              onChange={(e) => onLowStockUnitChange(e.target.value as PharmacyPackagingFieldState["lowStockUnit"])}
              className={clsx(WIZARD_INPUT_TEXT, "w-[8.5rem] shrink-0 text-base")}
            >
              <option value="tablet">{packagingState.baseUnit}</option>
              {packagingState.level1Enabled ? <option value="strip">{packagingState.level1Unit}</option> : null}
              {packagingState.level2Enabled ? <option value="box">{packagingState.level2Unit}</option> : null}
            </select>
          ) : null}
        </div>
      </label>

      {pharmacyMode ? <PharmacyBatchIntegrityBanner lang={lang} product={product} /> : null}
    </EditorSection>
  );
}
