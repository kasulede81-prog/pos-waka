import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import type { Language, PharmacyPackaging } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import { shelfIconFor } from "../../lib/productCategories";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { MEDICINE_FORMS } from "../../lib/pharmacyMedicine";
import {
  buildPharmacyMasterFromState,
  masterStateFromProduct,
  PharmacyMedicineMasterFields,
} from "../pharmacy/PharmacyMedicineMasterFields";
import { usePosStore } from "../../store/usePosStore";
import { defaultPharmacyCategoriesForBusinessType } from "../../lib/pharmacy";
import { pharmacyCostWarnings } from "../../lib/pharmacyCostIntegrity";
import {
  PHARMACY_BASE_UNITS,
  PHARMACY_LEVEL1_UNITS,
  PHARMACY_LEVEL2_UNITS,
  buyingUnitFromPackaging,
  calcCostPerBaseUnitUgx,
  calcTotalBaseUnits,
  packagingStockPreviewLines,
} from "../../lib/pharmacyPackaging";

type Step = "details" | "stockCost" | "selling";

const STEPS: Step[] = ["details", "stockCost", "selling"];

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
  const [categoryPick, setCategoryPick] = useState("");
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
    setCategoryPick("");
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
  const resolvedCategory = () => (categoryPick || category).trim() || t(lang, "generalCategory");

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
    () => calcCostPerBaseUnitUgx(Math.floor(Number(totalAmountPaid.replace(/\D/g, "")) || 0), totalBaseUnits),
    [totalAmountPaid, totalBaseUnits],
  );

  const previewLines = useMemo(() => {
    if (!draftPackaging?.enabled) return [];
    const outer = Math.floor(Number(receivedOuterQty.replace(/\D/g, "")) || 0);
    if (outer <= 0) return [];
    return packagingStockPreviewLines(draftPackaging, outer);
  }, [draftPackaging, receivedOuterQty]);

  const previewWarnings = useMemo(() => {
    const sell = Math.max(0, Math.floor(Number(tabletPrice.replace(/\D/g, "")) || 0));
    if (costPerUnit <= 0 && sell <= 0) return [];
    return pharmacyCostWarnings({
      id: "preview",
      name: name.trim() || "—",
      sellingMode: "unit",
      baseUnit: packagingEnabled ? baseUnit : "tablet",
      sellingPricePerUnitUgx: sell,
      costPricePerUnitUgx: costPerUnit,
      stockOnHand: 0,
      minimumStockAlert: 0,
      category: "",
      sku: "",
      updatedAt: "",
      version: 1,
    });
  }, [tabletPrice, costPerUnit, name, packagingEnabled, baseUnit]);

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
      return !name.trim() || !strength.trim() || !medicineForm.trim();
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

  if (!open) return null;

  const inputClass =
    "min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-lg font-bold outline-none ring-waka-300 focus:ring";
  const labelClass = "block text-sm font-bold text-stone-700";

  const outerLabel = level2Enabled
    ? level2Unit
    : level1Enabled
      ? level1Unit
      : baseUnit;

  return (
    <AppModalOverlay
      className="z-[58] flex flex-col bg-white pt-[max(0.5rem,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal
      aria-labelledby="pharmacy-add-medicine-title"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-100 px-4 py-3">
        {stepIndex > 0 ? (
          <button type="button" onClick={back} className="rounded-xl p-2 text-stone-600" aria-label={t(lang, "back")}>
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-bold text-stone-600">
            {t(lang, "cancel")}
          </button>
        )}
        <h2 id="pharmacy-add-medicine-title" className="flex-1 text-center text-lg font-black text-stone-900">
          {t(lang, "pharmacyPage_addMedicine")}
        </h2>
        <span className="w-12 text-right text-xs font-bold text-stone-500">
          {stepIndex + 1}/{STEPS.length}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {savedFlash ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-center text-lg font-black text-emerald-900">
            {t(lang, "pharmacyAddMedicine_saved")}
          </p>
        ) : null}

        {step === "details" ? (
          <div className="space-y-4">
            <h3 className="text-xl font-black text-stone-900">{t(lang, "pharmacyPackStepDetailsTitle")}</h3>
            <label className={labelClass}>
              {t(lang, "pharmacyPage_medicineName")} *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={uiPlaceholder(lang, preferences.businessType, "simpleAddStep1Example", preferences.pharmacyModeEnabled)}
                autoFocus
                className={clsx(inputClass, "mt-1")}
              />
            </label>
            <div>
              <p className={labelClass}>{t(lang, "pharmacyTerm_medicineCategory")} *</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {categoryOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCategoryPick(c);
                      setCategory(c);
                    }}
                    className={clsx(
                      "min-h-[44px] rounded-2xl border-2 px-2 text-sm font-black",
                      categoryPick === c ? "border-waka-500 bg-waka-600 text-white" : "border-stone-200 bg-white text-stone-900",
                    )}
                  >
                    {shelfIconFor(c) ? <span className="mr-1">{shelfIconFor(c)}</span> : null}
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <label className={labelClass}>
              {t(lang, "pharmacyStrengthLabel")} *
              <input
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder={t(lang, "pharmacyPlaceholder_strengthExample")}
                className={clsx(inputClass, "mt-1")}
              />
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyFormLabel")} *
              <select value={medicineForm} onChange={(e) => setMedicineForm(e.target.value)} className={clsx(inputClass, "mt-1")}>
                <option value="">{t(lang, "pharmacyFormSelect")}</option>
                {MEDICINE_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t(lang, "pharmacyReorderLevelLabel")}
              <input
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                className={clsx(inputClass, "mt-1")}
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
          <div className="space-y-4">
            <h3 className="text-xl font-black text-stone-900">{t(lang, "pharmacyOpeningBatchTitle")}</h3>
            <label className={labelClass}>
              {t(lang, "pharmacyOpeningBatchNumber")} *
              <input
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="LOT-001"
                className={clsx(inputClass, "mt-1 font-mono")}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                {t(lang, "pharmacyManufactureDate")}
                <input type="date" value={manufactureDate} onChange={(e) => setManufactureDate(e.target.value)} className={clsx(inputClass, "mt-1")} />
              </label>
              <label className={labelClass}>
                {t(lang, "pharmacyExpiryDateLabel")} *
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={clsx(inputClass, "mt-1")} />
              </label>
            </div>

            <h3 className="text-xl font-black text-stone-900">{t(lang, "pharmacyPackStepStockTitle")}</h3>

            <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <input
                type="checkbox"
                checked={packagingEnabled}
                onChange={(e) => setPackagingEnabled(e.target.checked)}
                className="mt-1 h-5 w-5"
              />
              <span className="text-sm font-semibold text-stone-800">{t(lang, "pharmacyPackEnableCheckbox")}</span>
            </label>

            {!packagingEnabled ? (
              <>
                <label className={labelClass}>
                  {t(lang, "pharmacyPackOpeningStock")}
                  <input
                    value={openingStock}
                    onChange={(e) => setOpeningStock(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    inputMode="numeric"
                    className={clsx(inputClass, "mt-1")}
                  />
                </label>
                <label className={labelClass}>
                  {t(lang, "pharmacyPackTotalPaid")}
                  <input
                    value={totalAmountPaid}
                    onChange={(e) => setTotalAmountPaid(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className={clsx(inputClass, "mt-1")}
                  />
                </label>
              </>
            ) : (
              <>
                <label className={labelClass}>
                  {t(lang, "pharmacyPackBaseUnit")}
                  <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} className={clsx(inputClass, "mt-1")}>
                    {PHARMACY_BASE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u.charAt(0).toUpperCase() + u.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm font-bold text-stone-800">
                  <input type="checkbox" checked={level1Enabled} onChange={(e) => setLevel1Enabled(e.target.checked)} />
                  {t(lang, "pharmacyPackLevel1Optional")}
                </label>
                {level1Enabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <select value={level1Unit} onChange={(e) => setLevel1Unit(e.target.value)} className={inputClass}>
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
                      className={inputClass}
                    />
                  </div>
                ) : null}

                <label className="flex items-center gap-2 text-sm font-bold text-stone-800">
                  <input type="checkbox" checked={level2Enabled} onChange={(e) => setLevel2Enabled(e.target.checked)} />
                  {t(lang, "pharmacyPackLevel2Optional")}
                </label>
                {level2Enabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <select value={level2Unit} onChange={(e) => setLevel2Unit(e.target.value)} className={inputClass}>
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
                      className={inputClass}
                    />
                  </div>
                ) : null}

                <label className={labelClass}>
                  {tTemplate(lang, "pharmacyPackReceivedOuter", { unit: outerLabel })}
                  <input
                    value={receivedOuterQty}
                    onChange={(e) => setReceivedOuterQty(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    className={clsx(inputClass, "mt-1")}
                  />
                </label>

                {!level1Enabled && !level2Enabled ? (
                  <label className={labelClass}>
                    {t(lang, "pharmacyPackOpeningStock")}
                    <input
                      value={openingStock}
                      onChange={(e) => setOpeningStock(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      inputMode="numeric"
                      className={clsx(inputClass, "mt-1")}
                    />
                  </label>
                ) : null}

                <label className={labelClass}>
                  {t(lang, "pharmacyPackTotalPaid")}
                  <input
                    value={totalAmountPaid}
                    onChange={(e) => setTotalAmountPaid(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    className={clsx(inputClass, "mt-1")}
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
          <div className="space-y-4">
            <h3 className="text-xl font-black text-stone-900">{t(lang, "pharmacyPackStepSellTitle")}</h3>
            <label className={labelClass}>
              {tTemplate(lang, "pharmacyPackTabletPrice", { unit: packagingEnabled ? baseUnit : "tablet" })}
              <input
                value={tabletPrice}
                onChange={(e) => setTabletPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                inputMode="numeric"
                className={clsx(inputClass, "mt-1")}
              />
            </label>
            {packagingEnabled && level1Enabled ? (
              <label className={labelClass}>
                {t(lang, "pharmacyPackStripPriceOptional")}
                <input
                  value={stripPrice}
                  onChange={(e) => setStripPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  inputMode="numeric"
                  className={clsx(inputClass, "mt-1")}
                />
              </label>
            ) : null}
            {packagingEnabled && level2Enabled ? (
              <label className={labelClass}>
                {t(lang, "pharmacyPackBoxPriceOptional")}
                <input
                  value={boxPrice}
                  onChange={(e) => setBoxPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  inputMode="numeric"
                  className={clsx(inputClass, "mt-1")}
                />
              </label>
            ) : null}
            {previewWarnings.map((w) => (
              <p key={w.kind} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
                {t(lang, w.messageKey)}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-stone-100 p-4">
        <button
          type="button"
          disabled={disabled || stepBlocked()}
          onClick={next}
          className="min-h-[52px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {step === "selling" ? t(lang, "pharmacyAddMedicine_save") : t(lang, "simpleAddNext")}
        </button>
      </footer>
    </AppModalOverlay>
  );
}
