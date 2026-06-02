import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import { shelfIconFor } from "../../lib/productCategories";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { MEDICINE_FORMS } from "../../lib/pharmacyMedicine";
import { usePosStore } from "../../store/usePosStore";
import { defaultPharmacyCategoriesForBusinessType } from "../../lib/pharmacy";
import { pharmacyCostWarnings } from "../../lib/pharmacyCostIntegrity";

type Step = "name" | "category" | "strength" | "form" | "expiry" | "stock" | "buyPrice" | "sellPrice";

const STEPS: Step[] = ["name", "category", "strength", "form", "expiry", "stock", "buyPrice", "sellPrice"];

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

  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [categoryPick, setCategoryPick] = useState("");
  const [strength, setStrength] = useState("");
  const [medicineForm, setMedicineForm] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [stockCount, setStockCount] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [minAlert, setMinAlert] = useState("10");
  const [savedFlash, setSavedFlash] = useState(false);

  const categoryOptions = useMemo(() => {
    const presets = defaultPharmacyCategoriesForBusinessType(preferences.businessType);
    return [...new Set([...shelves, ...presets])].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [shelves, preferences.businessType]);

  const reset = () => {
    setStep("name");
    setName("");
    setCategory("");
    setCategoryPick("");
    setStrength("");
    setMedicineForm("");
    setExpiryDate("");
    setStockCount("");
    setBuyPrice("");
    setSellPrice("");
    setMinAlert("10");
    setSavedFlash(false);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const stepIndex = STEPS.indexOf(step);

  const resolvedCategory = () => (categoryPick || category).trim() || t(lang, "generalCategory");

  const previewWarnings = useMemo(() => {
    const cost = Math.max(0, Math.floor(Number(buyPrice.replace(/\D/g, "")) || 0));
    const sell = Math.max(0, Math.floor(Number(sellPrice.replace(/\D/g, "")) || 0));
    if (cost <= 0 && sell <= 0) return [];
    return pharmacyCostWarnings({
      id: "preview",
      name: name.trim() || "—",
      sellingMode: "unit",
      baseUnit: "tablet",
      sellingPricePerUnitUgx: sell,
      costPricePerUnitUgx: cost,
      stockOnHand: 0,
      minimumStockAlert: 0,
      category: "",
      sku: "",
      updatedAt: "",
      version: 1,
    });
  }, [buyPrice, sellPrice, name]);

  const save = () => {
    const priceUgx = Math.max(0, Math.floor(Number(sellPrice.replace(/\D/g, "")) || 0));
    const costUgx = Math.max(0, Math.floor(Number(buyPrice.replace(/\D/g, "")) || 0));
    const stockQty = Math.max(0, Math.floor(Number(stockCount.replace(/\D/g, "")) || 0));
    if (!name.trim() || priceUgx <= 0 || costUgx <= 0 || stockQty <= 0) return false;

    const r = quickAddProduct({
      name: name.trim(),
      priceUgx,
      stockQty,
      category: resolvedCategory(),
      inferName: name.trim(),
      sellingMode: "unit",
      baseUnit: "tablet",
      medicineStrength: strength.trim() || null,
      medicineForm: medicineForm.trim() || null,
      expiryDate: expiryDate.trim() || null,
      costPricePerUnitUgx: costUgx,
      minimumStockAlert: Math.max(0, Math.floor(Number(minAlert) || 10)),
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
    if (step === "name") return !name.trim();
    if (step === "stock") return Math.floor(Number(stockCount.replace(/\D/g, "")) || 0) <= 0;
    if (step === "buyPrice") return Math.floor(Number(buyPrice.replace(/\D/g, "")) || 0) <= 0;
    if (step === "sellPrice") return Math.floor(Number(sellPrice.replace(/\D/g, "")) || 0) <= 0;
    return false;
  };

  const next = () => {
    if (stepBlocked()) return;
    if (step === "sellPrice") {
      save();
      return;
    }
    const i = stepIndex + 1;
    if (i < STEPS.length) setStep(STEPS[i]!);
  };

  const back = () => {
    const i = stepIndex - 1;
    if (i >= 0) setStep(STEPS[i]!);
  };

  if (!open) return null;

  const inputClass =
    "min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-lg font-bold outline-none ring-waka-300 focus:ring";

  return (
    <AppModalOverlay
      className="z-[58] flex flex-col bg-white pt-[max(0.5rem,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal
      aria-labelledby="pharmacy-add-medicine-title"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
        {stepIndex > 0 ? (
          <button type="button" onClick={back} className="rounded-xl p-2 text-slate-600" aria-label={t(lang, "back")}>
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600">
            {t(lang, "cancel")}
          </button>
        )}
        <h2 id="pharmacy-add-medicine-title" className="flex-1 text-center text-lg font-black text-slate-900">
          {t(lang, "pharmacyPage_addMedicine")}
        </h2>
        <span className="w-12 text-right text-xs font-bold text-slate-500">
          {stepIndex + 1}/{STEPS.length}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {savedFlash ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-center text-lg font-black text-emerald-900">
            {t(lang, "pharmacyAddMedicine_saved")}
          </p>
        ) : null}

        {step === "name" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyPage_medicineName")}</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={uiPlaceholder(lang, preferences.businessType, "simpleAddStep1Example", preferences.pharmacyModeEnabled)}
              autoFocus
              className={inputClass}
            />
          </div>
        ) : null}

        {step === "category" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyTerm_medicineCategory")}</h3>
            <p className="text-sm text-slate-600">
              {uiPlaceholder(lang, preferences.businessType, "simpleAddStep2Hint", preferences.pharmacyModeEnabled)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {categoryOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCategoryPick(c);
                    setCategory(c);
                  }}
                  className={clsx(
                    "min-h-[48px] rounded-2xl border-2 px-2 text-sm font-black",
                    categoryPick === c ? "border-waka-500 bg-waka-600 text-white" : "border-slate-200 bg-white text-slate-900",
                  )}
                >
                  {shelfIconFor(c) ? <span className="mr-1">{shelfIconFor(c)}</span> : null}
                  {c}
                </button>
              ))}
            </div>
            <input
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setCategoryPick("");
              }}
              placeholder={uiPlaceholder(lang, preferences.businessType, "simpleAddShelfPlaceholder", preferences.pharmacyModeEnabled)}
              className={inputClass}
            />
          </div>
        ) : null}

        {step === "strength" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyStrengthLabel")}</h3>
            <input
              value={strength}
              onChange={(e) => setStrength(e.target.value)}
              placeholder={t(lang, "pharmacyPlaceholder_strengthExample")}
              className={inputClass}
            />
          </div>
        ) : null}

        {step === "form" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyFormLabel")}</h3>
            <select value={medicineForm} onChange={(e) => setMedicineForm(e.target.value)} className={inputClass}>
              <option value="">{t(lang, "pharmacyFormSelect")}</option>
              {MEDICINE_FORMS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {step === "expiry" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyExpiryDateLabel")}</h3>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputClass} />
            <p className="text-xs font-medium text-slate-500">{t(lang, "pharmacyExpiryDateHint")}</p>
            <label className="block text-sm font-bold text-slate-700">
              {t(lang, "pharmacyReorderLevelLabel")}
              <input
                value={minAlert}
                onChange={(e) => setMinAlert(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                className={clsx(inputClass, "mt-1")}
              />
            </label>
          </div>
        ) : null}

        {step === "stock" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyAddMedicine_stockNow")}</h3>
            <p className="text-sm font-medium text-slate-600">{t(lang, "pharmacyOpeningStockRequiredHint")}</p>
            <input
              value={stockCount}
              onChange={(e) => setStockCount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="numeric"
              className={inputClass}
            />
          </div>
        ) : null}

        {step === "buyPrice" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyAddMedicine_buyPrice")}</h3>
            <p className="text-sm font-medium text-slate-600">{t(lang, "pharmacyAddMedicine_buyPriceHint")}</p>
            <input
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              className={inputClass}
            />
            <span className="text-xs font-bold text-slate-500">UGX {t(lang, "pharmacyPerUnit")}</span>
          </div>
        ) : null}

        {step === "sellPrice" ? (
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900">{t(lang, "pharmacyAddMedicine_sellPrice")}</h3>
            <input
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              className={inputClass}
            />
            <span className="text-xs font-bold text-slate-500">UGX {t(lang, "pharmacyPerUnit")}</span>
            {previewWarnings.map((w) => (
              <p key={w.kind} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
                {t(lang, w.messageKey)}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-slate-100 p-4">
        <button
          type="button"
          disabled={disabled || stepBlocked()}
          onClick={next}
          className="min-h-[52px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {step === "sellPrice" ? t(lang, "pharmacyAddMedicine_save") : t(lang, "simpleAddNext")}
        </button>
      </footer>
    </AppModalOverlay>
  );
}
