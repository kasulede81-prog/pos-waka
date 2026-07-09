import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, PharmacyPackaging } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import { CategoryShelfPicker } from "./CategoryShelfPicker";
import { MedicineFormSelect } from "./MedicineFormSelect";
import {
  buildPharmacyMasterFromState,
  masterStateFromProduct,
  PharmacyMedicineMasterFields,
} from "../pharmacy/PharmacyMedicineMasterFields";
import { usePosStore } from "../../store/usePosStore";
import { defaultPharmacyCategoriesForBusinessType } from "../../lib/pharmacy";
import { unitCostFromInvoiceTotal } from "../../lib/costPrecision";
import {
  PHARMACY_BASE_UNITS,
  PHARMACY_LEVEL1_UNITS,
  PHARMACY_LEVEL2_UNITS,
  buyingUnitFromPackaging,
  calcTotalBaseUnits,
  packagingStockPreviewLines,
} from "../../lib/pharmacyPackaging";
import { ProductWizardShell } from "./wizard/ProductWizardShell";
import { WizardFooter } from "./wizard/WizardFooter";
import { WizardStepHeading } from "./wizard/WizardStepHeading";
import { WizardPricingPanel } from "./wizard/WizardPricingPanel";
import { WIZARD_INPUT_NUMERIC, WIZARD_INPUT_TEXT } from "./wizard/wizardTokens";
import { PHARMACY_PRODUCT_WIZARD_STEPS } from "../../lib/productWizardSteps";
import { WakaSwitch } from "../enterprise/WakaSwitch";

type Step = (typeof PHARMACY_PRODUCT_WIZARD_STEPS)[number];

const STEPS: Step[] = [...PHARMACY_PRODUCT_WIZARD_STEPS];

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  shelves: string[];
  disabled?: boolean;
  onSaved: () => void;
};

export function PharmacyAddMedicineWizard({ lang, open, onClose, shelves, disabled, onSaved }: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const quickAddProduct = usePosStore((s) => s.quickAddProduct);

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [strength, setStrength] = useState("");
  const [medicineForm, setMedicineForm] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [minAlert, setMinAlert] = useState("10");

  const [packagingEnabled, setPackagingEnabled] = useState(false);
  const [baseUnit, setBaseUnit] = useState<string>("tablet");
  const [level1Enabled, setLevel1Enabled] = useState(false);
  const [level1Unit, setLevel1Unit] = useState<string>("strip");
  const [level1Qty, setLevel1Qty] = useState("");
  const [level2Enabled, setLevel2Enabled] = useState(false);
  const [level2Unit, setLevel2Unit] = useState<string>("box");
  const [level2Qty, setLevel2Qty] = useState("");
  const [receivedOuterQty, setReceivedOuterQty] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [totalAmountPaid, setTotalAmountPaid] = useState("");

  const [sellTablet, setSellTablet] = useState(true);
  const [sellStrip, setSellStrip] = useState(false);
  const [sellBox, setSellBox] = useState(false);
  const [tabletPrice, setTabletPrice] = useState("");
  const [stripPrice, setStripPrice] = useState("");
  const [boxPrice, setBoxPrice] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [masterState, setMasterState] = useState(() => masterStateFromProduct(null));
  const [batchNumber, setBatchNumber] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");

  const categoryOptions = useMemo(() => {
    const presets = defaultPharmacyCategoriesForBusinessType(preferences.businessType);
    return [...new Set([...shelves, ...presets])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [shelves, preferences.businessType]);

  const reset = () => {
    setStep("details");
    setName("");
    setCategory("");
    setStrength("");
    setMedicineForm("");
    setExpiryDate("");
    setMinAlert("10");
    setPackagingEnabled(false);
    setBaseUnit("tablet");
    setLevel1Enabled(false);
    setLevel1Unit("strip");
    setLevel1Qty("");
    setLevel2Enabled(false);
    setLevel2Unit("box");
    setLevel2Qty("");
    setReceivedOuterQty("");
    setOpeningStock("");
    setTotalAmountPaid("");
    setSellTablet(true);
    setSellStrip(false);
    setSellBox(false);
    setTabletPrice("");
    setStripPrice("");
    setBoxPrice("");
    setSavedFlash(false);
    setMasterState(masterStateFromProduct(null));
    setBatchNumber("");
    setManufactureDate("");
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const stepIndex = STEPS.indexOf(step);
  const resolvedCategory = () => category.trim() || t(lang, "generalCategory");

  const draftPackaging = useMemo((): PharmacyPackaging | null => {
    if (!packagingEnabled) return null;
    return {
      enabled: true,
      baseUnit,
      level1:
        level1Enabled && Math.floor(Number(level1Qty) || 0) > 0
          ? { unit: level1Unit, containsBaseUnits: Math.floor(Number(level1Qty)) }
          : null,
      level2:
        level2Enabled && Math.floor(Number(level2Qty) || 0) > 0
          ? { unit: level2Unit, containsLevel1Units: Math.floor(Number(level2Qty)) }
          : null,
      sell: { tablet: sellTablet, strip: sellStrip, box: sellBox },
      priceStripUgx: stripPrice ? Math.floor(Number(stripPrice.replace(/\D/g, "")) || 0) : null,
      priceBoxUgx: boxPrice ? Math.floor(Number(boxPrice.replace(/\D/g, "")) || 0) : null,
      batches: [],
    };
  }, [
    packagingEnabled,
    baseUnit,
    level1Enabled,
    level1Unit,
    level1Qty,
    level2Enabled,
    level2Unit,
    level2Qty,
    sellTablet,
    sellStrip,
    sellBox,
    stripPrice,
    boxPrice,
  ]);

  const totalBaseUnits = useMemo(() => {
    if (packagingEnabled && draftPackaging) {
      const outer = Math.floor(Number(receivedOuterQty.replace(/\D/g, "")) || 0);
      if (draftPackaging.level2 && outer > 0) {
        return calcTotalBaseUnits({ packaging: draftPackaging, receivedLevel2Qty: outer });
      }
      if (draftPackaging.level1 && outer > 0) {
        return calcTotalBaseUnits({ packaging: draftPackaging, receivedLevel1Qty: outer });
      }
      return calcTotalBaseUnits({
        packaging: draftPackaging,
        openingStockBase: Math.floor(Number(openingStock.replace(/\D/g, "")) || 0),
      });
    }
    return calcTotalBaseUnits({
      packaging: null,
      openingStockBase: Math.floor(Number(openingStock.replace(/\D/g, "")) || 0),
    });
  }, [packagingEnabled, draftPackaging, receivedOuterQty, openingStock, totalAmountPaid]);

  const costPerUnit = useMemo(
    () => unitCostFromInvoiceTotal(Math.floor(Number(totalAmountPaid.replace(/\D/g, "")) || 0), totalBaseUnits),
    [totalAmountPaid, totalBaseUnits],
  );

  const previewLines = useMemo(() => {
    if (!draftPackaging?.enabled) return [];
    const outer = Math.floor(Number(receivedOuterQty.replace(/\D/g, "")) || 0);
    if (outer <= 0) return [];
    return packagingStockPreviewLines(draftPackaging, outer);
  }, [draftPackaging, receivedOuterQty]);

  const tabletSell = Math.max(0, Math.floor(Number(tabletPrice.replace(/\D/g, "")) || 0));
  const stripSell = Math.max(0, Math.floor(Number(stripPrice.replace(/\D/g, "")) || 0));
  const boxSell = Math.max(0, Math.floor(Number(boxPrice.replace(/\D/g, "")) || 0));

  const extraUnitPrices = useMemo(() => {
    const rows: { label: string; sellPriceUgx: number }[] = [];
    if (packagingEnabled && level1Enabled && stripSell > 0) {
      rows.push({ label: t(lang, "pharmacyPackStripPriceOptional"), sellPriceUgx: stripSell });
    }
    if (packagingEnabled && level2Enabled && boxSell > 0) {
      rows.push({ label: t(lang, "pharmacyPackBoxPriceOptional"), sellPriceUgx: boxSell });
    }
    return rows;
  }, [packagingEnabled, level1Enabled, level2Enabled, stripSell, boxSell, lang]);

  const batchSummary =
    batchNumber.trim() && expiryDate.trim()
      ? `${t(lang, "pharmacyBatchNumberLabel")}: ${batchNumber.trim()} · ${t(lang, "pharmacyExpiryDateLabel")}: ${expiryDate}`
      : undefined;

  const save = () => {
    const priceUgx = Math.max(0, Math.floor(Number(tabletPrice.replace(/\D/g, "")) || 0));
    const stockQty = totalBaseUnits;
    if (!name.trim() || priceUgx <= 0 || costPerUnit <= 0 || stockQty <= 0) return false;

    const pkg = draftPackaging;
    const bu = pkg?.enabled ? buyingUnitFromPackaging(pkg) : { buyingUnit: null, conversionRate: null };

    const pharmacyMaster = buildPharmacyMasterFromState({
      ...masterState,
      brandName: name.trim() || masterState.brandName,
      strength: strength.trim(),
      medicineForm: medicineForm.trim(),
      medicineCategory: resolvedCategory(),
    });

    const r = quickAddProduct({
      name: (name.trim() || masterState.brandName).trim(),
      priceUgx,
      stockQty,
      category: resolvedCategory(),
      inferName: name.trim(),
      sellingMode: "unit",
      baseUnit: pkg?.enabled ? String(pkg.baseUnit) : "tablet",
      buyingUnit: bu.buyingUnit,
      conversionRate: bu.conversionRate,
      medicineStrength: strength.trim() || null,
      medicineForm: medicineForm.trim() || null,
      expiryDate: expiryDate.trim() || null,
      costPricePerUnitUgx: costPerUnit,
      minimumStockAlert: Math.max(0, Math.floor(Number(minAlert) || 10)),
      pharmacyPackaging: pkg,
      pharmacyMaster,
      primaryBarcode: masterState.primaryBarcode.trim() || null,
      openingBatch:
        stockQty > 0 && batchNumber.trim() && expiryDate.trim()
          ? {
              batchNumber: batchNumber.trim(),
              expiryDate: expiryDate.trim(),
              quantityBase: stockQty,
              unitCostUgx: costPerUnit,
              manufactureDate: manufactureDate.trim() || null,
              sellingPriceUgx: priceUgx,
            }
          : null,
    });
    if (!r.ok) return false;

    setSavedFlash(true);
    window.setTimeout(() => {
      onSaved();
      onClose();
      reset();
    }, 600);
    return true;
  };

  const stepBlocked = (): boolean => {
    if (step === "details") {
      return !name.trim() || !category.trim() || !strength.trim() || !medicineForm.trim();
    }
    if (step === "stockCost") {
      const paid = Math.floor(Number(totalAmountPaid.replace(/\D/g, "")) || 0);
      if (paid <= 0 || !batchNumber.trim() || !expiryDate.trim()) return true;
      if (packagingEnabled) {
        if (level2Enabled) {
          return Math.floor(Number(receivedOuterQty.replace(/\D/g, "")) || 0) <= 0;
        }
        if (level1Enabled) {
          return Math.floor(Number(receivedOuterQty.replace(/\D/g, "")) || 0) <= 0;
        }
        return Math.floor(Number(openingStock.replace(/\D/g, "")) || 0) <= 0;
      }
      return Math.floor(Number(openingStock.replace(/\D/g, "")) || 0) <= 0;
    }
    if (step === "selling") return Math.floor(Number(tabletPrice.replace(/\D/g, "")) || 0) <= 0;
    return false;
  };

  const next = () => {
    if (stepBlocked()) return;
    if (step === "selling") {
      save();
      return;
    }
    const i = stepIndex + 1;
    if (i < STEPS.length) {
      const nextStep = STEPS[i]!;
      setStep(nextStep);
      if (nextStep === "selling" && packagingEnabled) {
        setSellStrip(Boolean(level1Enabled));
        setSellBox(Boolean(level2Enabled));
      }
    }
  };

  const back = () => {
    const i = stepIndex - 1;
    if (i >= 0) setStep(STEPS[i]!);
  };

  const labelClass = "block text-sm font-bold text-foreground";
  const isLastStep = step === "selling";

  const outerLabel = level2Enabled
    ? level2Unit
    : level1Enabled
      ? level1Unit
      : baseUnit;

  return (
    <ProductWizardShell
      lang={lang}
      open={open}
      onClose={onClose}
      title={t(lang, "pharmacyPage_addMedicine")}
      titleId="pharmacy-add-medicine-title"
      stepIndex={stepIndex}
      totalSteps={STEPS.length}
      savedFlash={savedFlash}
      savedMessage={t(lang, "pharmacyAddMedicine_saved")}
      zClassName="z-[58]"
      footer={
        !savedFlash ? (
          <WizardFooter
            lang={lang}
            isLastStep={isLastStep}
            canGoBack={stepIndex > 0}
            canProceed={!stepBlocked()}
            disabled={disabled}
            onBack={back}
            onPrimary={next}
            primaryLabelKey={isLastStep ? "pharmacyAddMedicine_save" : undefined}
            nextLabelKey="simpleAddNext"
            primaryType="button"
          />
        ) : undefined
      }
    >
      {step === "details" ? (
          <div className="wizard-step-enter space-y-5">
            <WizardStepHeading title={t(lang, "pharmacyPackStepDetailsTitle")} />
            <label className={labelClass}>
              {t(lang, "pharmacyPage_medicineName")} *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={uiPlaceholder(lang, preferences.businessType, "simpleAddStep1Example", preferences.pharmacyModeEnabled)}
                autoFocus
                className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
              />
            </label>
            <div>
              <p className={labelClass}>{t(lang, "pharmacyTerm_medicineCategory")} *</p>
              <div className="mt-2">
                <CategoryShelfPicker
                  lang={lang}
                  options={categoryOptions}
                  value={category}
                  onChange={setCategory}
                  requireModeChoice
                  placeholder={uiPlaceholder(lang, preferences.businessType, "simpleAddShelfPlaceholder", preferences.pharmacyModeEnabled)}
                  inputClass={clsx(WIZARD_INPUT_TEXT, "mt-2")}
                />
              </div>
            </div>
            <label className={labelClass}>
              {t(lang, "pharmacyStrengthLabel")} *
              <input
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder={t(lang, "pharmacyPlaceholder_strengthExample")}
                className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
              />
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyFormLabel")} *
              <MedicineFormSelect lang={lang} value={medicineForm} onChange={setMedicineForm} />
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyReorderLevelLabel")}
              <input
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
              />
            </label>

            <PharmacyMedicineMasterFields
              lang={lang}
              state={{ ...masterState, brandName: name, strength, medicineForm }}
              onChange={(patch) => {
                if (patch.brandName !== undefined) setName(patch.brandName);
                if (patch.strength !== undefined) setStrength(patch.strength);
                if (patch.medicineForm !== undefined) setMedicineForm(patch.medicineForm);
                setMasterState((prev) => ({ ...prev, ...patch }));
              }}
              showStrengthForm={false}
            />
          </div>
        ) : null}

        {step === "stockCost" ? (
          <div className="wizard-step-enter space-y-5">
            <WizardStepHeading title={t(lang, "pharmacyOpeningBatchTitle")} />
            <label className={labelClass}>
              {t(lang, "pharmacyOpeningBatchNumber")} *
              <input
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="LOT-001"
                className={clsx(WIZARD_INPUT_TEXT, "mt-2 font-mono")}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                {t(lang, "pharmacyManufactureDate")}
                <input type="date" value={manufactureDate} onChange={(e) => setManufactureDate(e.target.value)} className={clsx(WIZARD_INPUT_TEXT, "mt-2")} />
              </label>
              <label className={labelClass}>
                {t(lang, "pharmacyExpiryDateLabel")} *
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={clsx(WIZARD_INPUT_TEXT, "mt-2")} />
              </label>
            </div>

            <WizardStepHeading title={t(lang, "pharmacyPackStepStockTitle")} />

            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <WakaSwitch
                checked={packagingEnabled}
                onCheckedChange={setPackagingEnabled}
                label={t(lang, "pharmacyPackEnableCheckbox")}
              />
            </div>

            {!packagingEnabled ? (
              <>
                <label className={labelClass}>
                  {t(lang, "pharmacyPackOpeningStock")}
                  <input
                    value={openingStock}
                    onChange={(e) => setOpeningStock(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    inputMode="numeric"
                    className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
                  />
                </label>
                <label className={labelClass}>
                  {t(lang, "pharmacyPackTotalPaid")}
                  <input
                    value={totalAmountPaid}
                    onChange={(e) => setTotalAmountPaid(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
                  />
                </label>
              </>
            ) : (
              <>
                <label className={labelClass}>
                  {t(lang, "pharmacyPackBaseUnit")}
                  <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} className={clsx(WIZARD_INPUT_TEXT, "mt-2")}>
                    {PHARMACY_BASE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u.charAt(0).toUpperCase() + u.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>

                <WakaSwitch
                  checked={level1Enabled}
                  onCheckedChange={setLevel1Enabled}
                  label={t(lang, "pharmacyPackLevel1Optional")}
                  className="text-sm font-bold text-stone-800"
                />
                {level1Enabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <select value={level1Unit} onChange={(e) => setLevel1Unit(e.target.value)} className={WIZARD_INPUT_TEXT}>
                      {PHARMACY_LEVEL1_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <input
                      value={level1Qty}
                      onChange={(e) => setLevel1Qty(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder={t(lang, "pharmacyPackContainsBase")}
                      inputMode="numeric"
                      className={WIZARD_INPUT_TEXT}
                    />
                  </div>
                ) : null}

                <WakaSwitch
                  checked={level2Enabled}
                  onCheckedChange={setLevel2Enabled}
                  label={t(lang, "pharmacyPackLevel2Optional")}
                  className="text-sm font-bold text-stone-800"
                />
                {level2Enabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <select value={level2Unit} onChange={(e) => setLevel2Unit(e.target.value)} className={WIZARD_INPUT_TEXT}>
                      {PHARMACY_LEVEL2_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <input
                      value={level2Qty}
                      onChange={(e) => setLevel2Qty(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder={t(lang, "pharmacyPackContainsL1")}
                      inputMode="numeric"
                      className={WIZARD_INPUT_TEXT}
                    />
                  </div>
                ) : null}

                <label className={labelClass}>
                  {tTemplate(lang, "pharmacyPackReceivedOuter", { unit: outerLabel })}
                  <input
                    value={receivedOuterQty}
                    onChange={(e) => setReceivedOuterQty(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
                  />
                </label>

                {!level1Enabled && !level2Enabled ? (
                  <label className={labelClass}>
                    {t(lang, "pharmacyPackOpeningStock")}
                    <input
                      value={openingStock}
                      onChange={(e) => setOpeningStock(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      inputMode="numeric"
                      className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
                    />
                  </label>
                ) : null}

                <label className={labelClass}>
                  {t(lang, "pharmacyPackTotalPaid")}
                  <input
                    value={totalAmountPaid}
                    onChange={(e) => setTotalAmountPaid(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
                  />
                </label>

                {previewLines.length > 0 ? (
                  <div className="rounded-2xl border border-waka-200 bg-waka-50 p-4">
                    <p className="text-sm font-black text-waka-900">{t(lang, "pharmacyPackPreviewTitle")}</p>
                    <ul className="mt-2 space-y-1 text-sm font-bold text-waka-800">
                      {previewLines.map((line, i) => (
                        <li key={i}>
                          {line.count.toLocaleString()} {line.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}

            {costPerUnit > 0 && totalBaseUnits > 0 ? (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-900">
                {t(lang, "pharmacyPackCostPreview")}: {costPerUnit.toLocaleString()} UGX
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "selling" ? (
          <div className="wizard-step-enter space-y-5">
            <WizardStepHeading title={t(lang, "pharmacyPackStepSellTitle")} />
            <label className={labelClass}>
              {tTemplate(lang, "pharmacyPackTabletPrice", { unit: packagingEnabled ? baseUnit : "tablet" })}
              <div className="relative mt-2">
                <input
                  value={tabletPrice}
                  onChange={(e) => setTabletPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  inputMode="numeric"
                  autoFocus
                  className={clsx(WIZARD_INPUT_NUMERIC, "pr-16")}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                  UGX
                </span>
              </div>
            </label>
            {packagingEnabled && level1Enabled ? (
              <label className={labelClass}>
                {t(lang, "pharmacyPackStripPriceOptional")}
                <div className="relative mt-2">
                  <input
                    value={stripPrice}
                    onChange={(e) => setStripPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className={clsx(WIZARD_INPUT_NUMERIC, "pr-16")}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    UGX
                  </span>
                </div>
              </label>
            ) : null}
            {packagingEnabled && level2Enabled ? (
              <label className={labelClass}>
                {t(lang, "pharmacyPackBoxPriceOptional")}
                <div className="relative mt-2">
                  <input
                    value={boxPrice}
                    onChange={(e) => setBoxPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className={clsx(WIZARD_INPUT_NUMERIC, "pr-16")}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    UGX
                  </span>
                </div>
              </label>
            ) : null}
            {costPerUnit > 0 && tabletSell > 0 ? (
              <WizardPricingPanel
                lang={lang}
                pharmacyMode
                unitCostUgx={costPerUnit}
                sellPriceUgx={tabletSell}
                unitLabel={packagingEnabled ? baseUnit : "tablet"}
                packCostUgx={Math.floor(Number(totalAmountPaid.replace(/\D/g, "")) || 0)}
                piecesPerPack={totalBaseUnits}
                packLabel={outerLabel}
                extraUnitPrices={extraUnitPrices}
                batchSummary={batchSummary}
                controlledIndicator={masterState.controlledDrug}
              />
            ) : null}
          </div>
        ) : null}
    </ProductWizardShell>
  );
}
