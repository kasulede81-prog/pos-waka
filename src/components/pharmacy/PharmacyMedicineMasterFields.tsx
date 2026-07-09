import clsx from "clsx";
import type { Language, PharmacyControlledSchedule, PharmacyMedicineMaster, PharmacyMedicineOtcClass, Product } from "../../types";
import { t } from "../../lib/i18n";
import { MEDICINE_FORMS } from "../../lib/pharmacyMedicine";
import { WakaSwitch } from "../enterprise/WakaSwitch";

const CONTROLLED_SCHEDULES: PharmacyControlledSchedule[] = [
  "none",
  "schedule_2",
  "schedule_3",
  "schedule_4",
  "narcotic",
  "psychotropic",
];

export type PharmacyMedicineMasterFieldState = {
  brandName: string;
  genericName: string;
  strength: string;
  medicineForm: string;
  manufacturer: string;
  country: string;
  registrationNumber: string;
  medicineCategory: string;
  otcOrPrescription: PharmacyMedicineOtcClass | "";
  controlledDrug: boolean;
  controlledSchedule: PharmacyControlledSchedule;
  regulatoryCategory: string;
  maxQuantityPerDispense: string;
  managerOverrideRequired: boolean;
  witnessRequired: boolean;
  refrigerated: boolean;
  hazardous: boolean;
  batchTracked: boolean;
  expiryTracked: boolean;
  primaryBarcode: string;
  secondaryBarcodes: string;
  supplierSku: string;
  storageNotes: string;
};

export function masterStateFromProduct(product: Product | null, fallbackName = ""): PharmacyMedicineMasterFieldState {
  const m = product?.pharmacyMaster;
  const barcodes = m?.barcodes ?? (product?.sku ? [product.sku] : []);
  return {
    brandName: m?.brandName?.trim() || product?.name?.trim() || fallbackName,
    genericName: m?.genericName?.trim() || "",
    strength: product?.medicineStrength?.trim() || "",
    medicineForm: product?.medicineForm?.trim() || "",
    manufacturer: m?.manufacturer?.trim() || "",
    country: m?.country?.trim() || "",
    registrationNumber: m?.registrationNumber?.trim() || "",
    medicineCategory: m?.medicineCategory?.trim() || product?.category?.trim() || "",
    otcOrPrescription: m?.otcOrPrescription ?? "otc",
    controlledDrug: Boolean(m?.controlledDrug),
    controlledSchedule: m?.controlledSchedule ?? (m?.controlledDrug ? "schedule_3" : "none"),
    regulatoryCategory: m?.regulatoryCategory?.trim() || "",
    maxQuantityPerDispense:
      m?.maxQuantityPerDispense != null ? String(m.maxQuantityPerDispense) : "",
    managerOverrideRequired: m?.managerOverrideRequired ?? Boolean(m?.controlledDrug),
    witnessRequired: Boolean(m?.witnessRequired),
    refrigerated: Boolean(m?.refrigerated),
    hazardous: Boolean(m?.hazardous),
    batchTracked: m?.batchTracked !== false,
    expiryTracked: m?.expiryTracked !== false,
    primaryBarcode: barcodes[0]?.trim() || product?.sku?.trim() || "",
    secondaryBarcodes: barcodes.slice(1).join(", "),
    supplierSku: m?.supplierSku?.trim() || "",
    storageNotes: m?.storageNotes?.trim() || "",
  };
}

export function buildPharmacyMasterFromState(state: PharmacyMedicineMasterFieldState): PharmacyMedicineMaster {
  const secondary = state.secondaryBarcodes
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const barcodes = [...new Set([state.primaryBarcode.trim(), ...secondary].filter(Boolean))];
  return {
    brandName: state.brandName.trim() || null,
    genericName: state.genericName.trim() || null,
    manufacturer: state.manufacturer.trim() || null,
    country: state.country.trim() || null,
    registrationNumber: state.registrationNumber.trim() || null,
    medicineCategory: state.medicineCategory.trim() || null,
    otcOrPrescription: state.otcOrPrescription || "otc",
    controlledDrug: state.controlledDrug,
    controlledSchedule: state.controlledDrug ? state.controlledSchedule : "none",
    regulatoryCategory: state.regulatoryCategory.trim() || null,
    maxQuantityPerDispense: state.maxQuantityPerDispense.trim()
      ? Math.max(1, Math.floor(Number(state.maxQuantityPerDispense)))
      : null,
    managerOverrideRequired: state.managerOverrideRequired,
    witnessRequired: state.witnessRequired,
    refrigerated: state.refrigerated,
    hazardous: state.hazardous,
    batchTracked: state.batchTracked,
    expiryTracked: state.expiryTracked,
    barcodes,
    supplierSku: state.supplierSku.trim() || null,
    storageNotes: state.storageNotes.trim() || null,
  };
}

type Props = {
  lang: Language;
  state: PharmacyMedicineMasterFieldState;
  onChange: (patch: Partial<PharmacyMedicineMasterFieldState>) => void;
  showStrengthForm?: boolean;
  hideBrandName?: boolean;
  hideGeneric?: boolean;
  compact?: boolean;
};

const inputClass =
  "min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-bold outline-none ring-waka-300 focus:ring";
const labelClass = "block text-sm font-bold text-stone-700";
const sectionClass = "rounded-2xl border border-stone-200 bg-stone-50/80 p-4 space-y-3";

export function PharmacyMedicineMasterFields({
  lang,
  state,
  onChange,
  showStrengthForm = true,
  hideBrandName,
  hideGeneric,
  compact,
}: Props) {
  const flagClass = clsx(
    "flex min-h-[48px] items-center gap-3 rounded-2xl border-2 px-4 py-2 touch-manipulation",
    compact ? "text-sm" : "text-base",
  );

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h4 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "pharmacyMasterSectionIdentity")}</h4>
        {hideBrandName ? null : (
        <label className={labelClass}>
          {t(lang, "pharmacyBrandName")}
          <input
            value={state.brandName}
            onChange={(e) => onChange({ brandName: e.target.value })}
            className={clsx(inputClass, "mt-1")}
          />
        </label>
        )}
        {hideGeneric ? null : (
        <label className={labelClass}>
          {t(lang, "pharmacyGenericName")}
          <input
            value={state.genericName}
            onChange={(e) => onChange({ genericName: e.target.value })}
            className={clsx(inputClass, "mt-1")}
          />
        </label>
        )}
        {showStrengthForm ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              {t(lang, "pharmacyStrengthLabel")}
              <input
                value={state.strength}
                onChange={(e) => onChange({ strength: e.target.value })}
                placeholder={t(lang, "pharmacyPlaceholder_strengthExample")}
                className={clsx(inputClass, "mt-1")}
              />
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyFormLabel")}
              <select
                value={state.medicineForm}
                onChange={(e) => onChange({ medicineForm: e.target.value })}
                className={clsx(inputClass, "mt-1")}
              >
                <option value="">{t(lang, "pharmacyFormSelect")}</option>
                {MEDICINE_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <label className={labelClass}>
          {t(lang, "pharmacyAtcCategory")}
          <input
            value={state.medicineCategory}
            onChange={(e) => onChange({ medicineCategory: e.target.value })}
            placeholder={t(lang, "pharmacyAtcCategoryHint")}
            className={clsx(inputClass, "mt-1")}
          />
        </label>
      </section>

      <section className={sectionClass}>
        <h4 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "pharmacyMasterSectionRegulatory")}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            {t(lang, "pharmacyManufacturer")}
            <input
              value={state.manufacturer}
              onChange={(e) => onChange({ manufacturer: e.target.value })}
              className={clsx(inputClass, "mt-1")}
            />
          </label>
          <label className={labelClass}>
            {t(lang, "pharmacyCountry")}
            <input
              value={state.country}
              onChange={(e) => onChange({ country: e.target.value })}
              className={clsx(inputClass, "mt-1")}
            />
          </label>
        </div>
        <label className={labelClass}>
          {t(lang, "pharmacyRegistration")}
          <input
            value={state.registrationNumber}
            onChange={(e) => onChange({ registrationNumber: e.target.value })}
            className={clsx(inputClass, "mt-1")}
          />
        </label>
        <div>
          <p className={labelClass}>{t(lang, "pharmacyOtcPrescription")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["otc", "prescription"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onChange({ otcOrPrescription: kind })}
                className={clsx(
                  "min-h-[48px] rounded-2xl border-2 text-sm font-black touch-manipulation",
                  state.otcOrPrescription === kind
                    ? "border-waka-500 bg-waka-600 text-white"
                    : "border-stone-200 bg-white text-stone-900",
                )}
              >
                {t(lang, kind === "otc" ? "pharmacyOtc" : "pharmacyPrescriptionRx")}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className={clsx(flagClass, state.controlledDrug ? "border-violet-400 bg-violet-50" : "border-stone-200 bg-white")}>
            <WakaSwitch
              checked={state.controlledDrug}
              onCheckedChange={(checked) =>
                onChange({
                  controlledDrug: checked,
                  controlledSchedule: checked && state.controlledSchedule === "none" ? "schedule_3" : state.controlledSchedule,
                  managerOverrideRequired: checked ? true : state.managerOverrideRequired,
                })
              }
              label={t(lang, "pharmacyControlled")}
            />
          </div>
          <div className={clsx(flagClass, state.refrigerated ? "border-sky-400 bg-sky-50" : "border-stone-200 bg-white")}>
            <WakaSwitch
              checked={state.refrigerated}
              onCheckedChange={(checked) => onChange({ refrigerated: checked })}
              label={t(lang, "pharmacyRefrigerated")}
            />
          </div>
          <div className={clsx(flagClass, state.hazardous ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-white")}>
            <WakaSwitch
              checked={state.hazardous}
              onCheckedChange={(checked) => onChange({ hazardous: checked })}
              label={t(lang, "pharmacyHazardous")}
            />
          </div>
          <div className={clsx(flagClass, state.batchTracked ? "border-teal-400 bg-teal-50" : "border-stone-200 bg-white")}>
            <WakaSwitch
              checked={state.batchTracked}
              onCheckedChange={(checked) => onChange({ batchTracked: checked })}
              label={t(lang, "pharmacyBatchTracked")}
            />
          </div>
          <div className={clsx(flagClass, state.expiryTracked ? "border-teal-400 bg-teal-50" : "border-stone-200 bg-white")}>
            <WakaSwitch
              checked={state.expiryTracked}
              onCheckedChange={(checked) => onChange({ expiryTracked: checked })}
              label={t(lang, "pharmacyExpiryTracked")}
            />
          </div>
        </div>
        {state.controlledDrug ? (
          <div className="mt-3 space-y-3 rounded-2xl border-2 border-violet-200 bg-violet-50/60 p-4">
            <h5 className="text-xs font-black uppercase text-violet-800">{t(lang, "pharmacyComplianceMasterSection")}</h5>
            <label className={labelClass}>
              {t(lang, "pharmacyComplianceSchedule")}
              <select
                value={state.controlledSchedule}
                onChange={(e) => onChange({ controlledSchedule: e.target.value as PharmacyControlledSchedule })}
                className={clsx(inputClass, "mt-1")}
              >
                {CONTROLLED_SCHEDULES.filter((s) => s !== "none").map((s) => (
                  <option key={s} value={s}>
                    {t(lang, `pharmacyComplianceSchedule_${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyComplianceRegCategory")}
              <input
                value={state.regulatoryCategory}
                onChange={(e) => onChange({ regulatoryCategory: e.target.value })}
                placeholder={t(lang, "pharmacyComplianceRegCategoryPh")}
                className={clsx(inputClass, "mt-1")}
              />
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyComplianceMaxQty")}
              <input
                type="number"
                min={1}
                value={state.maxQuantityPerDispense}
                onChange={(e) => onChange({ maxQuantityPerDispense: e.target.value })}
                className={clsx(inputClass, "mt-1")}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className={clsx(flagClass, state.managerOverrideRequired ? "border-violet-400 bg-white" : "border-stone-200 bg-white")}>
                <WakaSwitch
                  checked={state.managerOverrideRequired}
                  onCheckedChange={(checked) => onChange({ managerOverrideRequired: checked })}
                  label={t(lang, "pharmacyComplianceManagerOverride")}
                />
              </div>
              <div className={clsx(flagClass, state.witnessRequired ? "border-violet-400 bg-white" : "border-stone-200 bg-white")}>
                <WakaSwitch
                  checked={state.witnessRequired}
                  onCheckedChange={(checked) => onChange({ witnessRequired: checked })}
                  label={t(lang, "pharmacyComplianceWitnessMedicine")}
                />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className={sectionClass}>
        <h4 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "pharmacyMasterSectionCodes")}</h4>
        <label className={labelClass}>
          {t(lang, "pharmacyPrimaryBarcode")}
          <input
            value={state.primaryBarcode}
            onChange={(e) => onChange({ primaryBarcode: e.target.value })}
            className={clsx(inputClass, "mt-1 font-mono")}
          />
        </label>
        <label className={labelClass}>
          {t(lang, "pharmacySecondaryBarcodes")}
          <input
            value={state.secondaryBarcodes}
            onChange={(e) => onChange({ secondaryBarcodes: e.target.value })}
            placeholder={t(lang, "pharmacySecondaryBarcodesHint")}
            className={clsx(inputClass, "mt-1 font-mono")}
          />
        </label>
        <label className={labelClass}>
          {t(lang, "pharmacySupplierSku")}
          <input
            value={state.supplierSku}
            onChange={(e) => onChange({ supplierSku: e.target.value })}
            className={clsx(inputClass, "mt-1")}
          />
        </label>
      </section>

      <section className={sectionClass}>
        <h4 className="text-sm font-black uppercase tracking-wide text-stone-500">{t(lang, "pharmacyMasterSectionStorage")}</h4>
        <label className={labelClass}>
          {t(lang, "pharmacyStorageNotes")}
          <textarea
            value={state.storageNotes}
            onChange={(e) => onChange({ storageNotes: e.target.value })}
            rows={3}
            className={clsx(inputClass, "mt-1 min-h-[80px] resize-y")}
          />
        </label>
      </section>
    </div>
  );
}
