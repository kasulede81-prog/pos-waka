import clsx from "clsx";
import type { Language, PharmacyPackaging } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  PHARMACY_BASE_UNITS,
  PHARMACY_LEVEL1_UNITS,
  PHARMACY_LEVEL2_UNITS,
} from "../../lib/pharmacyPackaging";

export type PharmacyPackagingFieldState = {
  enabled: boolean;
  baseUnit: string;
  level1Enabled: boolean;
  level1Unit: string;
  level1Qty: string;
  level2Enabled: boolean;
  level2Unit: string;
  level2Qty: string;
  sellStrip: boolean;
  sellBox: boolean;
  tabletPrice: string;
  stripPrice: string;
  boxPrice: string;
  lowStockUnit: "tablet" | "strip" | "box";
};

export function packagingStateFromProduct(pkg: PharmacyPackaging | null | undefined): PharmacyPackagingFieldState {
  const enabled = Boolean(pkg?.enabled);
  return {
    enabled,
    baseUnit: pkg?.baseUnit ?? "tablet",
    level1Enabled: Boolean(pkg?.level1?.containsBaseUnits),
    level1Unit: pkg?.level1?.unit ?? "strip",
    level1Qty: pkg?.level1?.containsBaseUnits ? String(pkg.level1.containsBaseUnits) : "10",
    level2Enabled: Boolean(pkg?.level2?.containsLevel1Units),
    level2Unit: pkg?.level2?.unit ?? "box",
    level2Qty: pkg?.level2?.containsLevel1Units ? String(pkg.level2.containsLevel1Units) : "10",
    sellStrip: pkg?.sell.strip ?? false,
    sellBox: pkg?.sell.box ?? false,
    tabletPrice: "",
    stripPrice: pkg?.priceStripUgx != null ? String(pkg.priceStripUgx) : "",
    boxPrice: pkg?.priceBoxUgx != null ? String(pkg.priceBoxUgx) : "",
    lowStockUnit: pkg?.lowStockAlertUnit ?? "tablet",
  };
}

export function buildPackagingFromState(
  state: PharmacyPackagingFieldState,
  _tabletPriceUgx: number,
  existing?: import("../../types").PharmacyPackaging | null,
): PharmacyPackaging | null {
  if (!state.enabled) return null;
  const level1 =
    state.level1Enabled && Math.floor(Number(state.level1Qty) || 0) > 0
      ? { unit: state.level1Unit, containsBaseUnits: Math.floor(Number(state.level1Qty)) }
      : null;
  const level2 =
    state.level2Enabled && Math.floor(Number(state.level2Qty) || 0) > 0
      ? { unit: state.level2Unit, containsLevel1Units: Math.floor(Number(state.level2Qty)) }
      : null;
  const stripRaw = Math.floor(Number(state.stripPrice.replace(/\D/g, "")) || 0);
  const boxRaw = Math.floor(Number(state.boxPrice.replace(/\D/g, "")) || 0);
  return {
    enabled: true,
    baseUnit: state.baseUnit,
    level1,
    level2,
    sell: {
      tablet: true,
      strip: state.sellStrip && Boolean(level1),
      box: state.sellBox && Boolean(level2),
    },
    priceStripUgx: stripRaw > 0 ? stripRaw : null,
    priceBoxUgx: boxRaw > 0 ? boxRaw : null,
    lowStockAlertUnit: state.lowStockUnit,
    batches: existing?.batches ?? [],
  };
}

type Props = {
  lang: Language;
  state: PharmacyPackagingFieldState;
  onChange: (patch: Partial<PharmacyPackagingFieldState>) => void;
  /** When true, tablet price is edited elsewhere (edit medicine modal). */
  hideTabletPrice?: boolean;
  showEnableToggle?: boolean;
  inputClass: string;
  labelClass: string;
};

export function PharmacyPackagingFields({
  lang,
  state,
  onChange,
  hideTabletPrice = false,
  showEnableToggle = true,
  inputClass,
  labelClass,
}: Props) {
  return (
    <div className="space-y-4 rounded-2xl border-2 border-teal-100 bg-teal-50/30 p-4">
      {showEnableToggle ? (
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="mt-1 h-5 w-5 accent-teal-600"
          />
          <span className="text-sm font-semibold text-stone-800">{t(lang, "pharmacyPackEnableCheckbox")}</span>
        </label>
      ) : null}

      {state.enabled ? (
        <>
          <label className={labelClass}>
            {t(lang, "pharmacyPackBaseUnit")}
            <select
              value={state.baseUnit}
              onChange={(e) => onChange({ baseUnit: e.target.value })}
              className={clsx(inputClass, "mt-1")}
            >
              {PHARMACY_BASE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u.charAt(0).toUpperCase() + u.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-bold text-stone-800">
            <input
              type="checkbox"
              checked={state.level1Enabled}
              onChange={(e) => onChange({ level1Enabled: e.target.checked })}
            />
            {t(lang, "pharmacyPackLevel1Optional")}
          </label>
          {state.level1Enabled ? (
            <div className="grid grid-cols-2 gap-2">
              <select
                value={state.level1Unit}
                onChange={(e) => onChange({ level1Unit: e.target.value })}
                className={inputClass}
              >
                {PHARMACY_LEVEL1_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <input
                value={state.level1Qty}
                onChange={(e) => onChange({ level1Qty: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder={t(lang, "pharmacyPackContainsBase")}
                inputMode="numeric"
                className={inputClass}
              />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm font-bold text-stone-800">
            <input
              type="checkbox"
              checked={state.level2Enabled}
              onChange={(e) => onChange({ level2Enabled: e.target.checked })}
            />
            {t(lang, "pharmacyPackLevel2Optional")}
          </label>
          {state.level2Enabled ? (
            <div className="grid grid-cols-2 gap-2">
              <select
                value={state.level2Unit}
                onChange={(e) => onChange({ level2Unit: e.target.value })}
                className={inputClass}
              >
                {PHARMACY_LEVEL2_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <input
                value={state.level2Qty}
                onChange={(e) => onChange({ level2Qty: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder={t(lang, "pharmacyPackContainsL1")}
                inputMode="numeric"
                className={inputClass}
              />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {!hideTabletPrice ? (
              <label className={labelClass}>
                {tTemplate(lang, "pharmacyPackTabletPrice", { unit: state.baseUnit })}
                <input
                  value={state.tabletPrice}
                  onChange={(e) => onChange({ tabletPrice: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                  inputMode="numeric"
                  className={clsx(inputClass, "mt-1")}
                />
              </label>
            ) : null}
            {state.level1Enabled ? (
              <label className={labelClass}>
                {t(lang, "pharmacyPackStripPriceOptional")}
                <input
                  value={state.stripPrice}
                  onChange={(e) => onChange({ stripPrice: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                  inputMode="numeric"
                  className={clsx(inputClass, "mt-1")}
                />
                <label className="mt-2 flex items-center gap-2 text-xs font-bold text-stone-600">
                  <input
                    type="checkbox"
                    checked={state.sellStrip}
                    onChange={(e) => onChange({ sellStrip: e.target.checked })}
                  />
                  {t(lang, "pharmacyPackSellStrip")}
                </label>
              </label>
            ) : null}
            {state.level2Enabled ? (
              <label className={labelClass}>
                {t(lang, "pharmacyPackBoxPriceOptional")}
                <input
                  value={state.boxPrice}
                  onChange={(e) => onChange({ boxPrice: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                  inputMode="numeric"
                  className={clsx(inputClass, "mt-1")}
                />
                <label className="mt-2 flex items-center gap-2 text-xs font-bold text-stone-600">
                  <input
                    type="checkbox"
                    checked={state.sellBox}
                    onChange={(e) => onChange({ sellBox: e.target.checked })}
                  />
                  {t(lang, "pharmacyPackSellBox")}
                </label>
              </label>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
