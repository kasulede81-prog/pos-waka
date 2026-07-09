import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { CategoryShelfPicker } from "./CategoryShelfPicker";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import { usePosStore } from "../../store/usePosStore";
import {
  PACK_TYPE_OPTIONS,
  SELL_UNIT_OPTIONS,
  buildProductFromSimpleWizard,
  packKindLabel,
  sellUnitLabel,
  type BuiltWizardProduct,
  type PackKind,
  type SellUnitKind,
} from "../../lib/simpleProductWizard";
import { validateAuditReason } from "../../lib/auditReasons";
import type { WizardPrefillFromAi } from "../../lib/ai/mapAiSuggestionToWizard";
import { CostValidationPreview } from "./CostValidationPreview";
import { ProductWizardShell } from "./wizard/ProductWizardShell";
import { WizardFooter } from "./wizard/WizardFooter";
import { WizardStepHeading } from "./wizard/WizardStepHeading";
import { WizardInfoCard } from "./wizard/WizardInfoCard";
import {
  WIZARD_INPUT_NUMERIC,
  WIZARD_INPUT_TEXT,
  wizardChoiceButtonClass,
} from "./wizard/wizardTokens";
import { RETAIL_PRODUCT_WIZARD_STEPS } from "../../lib/productWizardSteps";

export type SimpleAddWizardStep =
  | "name"
  | "shelf"
  | "sellUnit"
  | "pack"
  | "piecesPerPack"
  | "stock"
  | "sellPrice"
  | "buyPrice";

type Step = SimpleAddWizardStep;

const STEPS: Step[] = [...RETAIL_PRODUCT_WIZARD_STEPS] as Step[];

export type SimpleAddWizardPrefill = WizardPrefillFromAi;

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  shelves: string[];
  generalCategoryLabel: string;
  disabled?: boolean;
  onSave: (payload: BuiltWizardProduct | null, opts?: { auditReason?: string }) => boolean;
  prefill?: SimpleAddWizardPrefill;
  initialStep?: SimpleAddWizardStep;
  editingProduct?: Product | null;
};

/** Fixed wizard flow — every product follows the same steps. */
const TOTAL_STEPS = STEPS.length;

function WizardAutoConfiguredCard({ lang, value }: { lang: Language; value: string }) {
  return (
    <div className="space-y-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-4 shadow-sm">
      <p className="text-sm font-bold text-muted-foreground">{t(lang, "simpleAddPackTypeLabel")}</p>
      <p className="text-xl font-black text-foreground">{value}</p>
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
        {t(lang, "simpleAddAutoConfigured")}
      </p>
    </div>
  );
}
function applyWizardPrefill(
  prefill: SimpleAddWizardPrefill,
  _shelves: string[],
  setters: {
    setName: (v: string) => void;
    setShelf: (v: string) => void;
    setSellUnit: (v: SellUnitKind) => void;
    setSellUnitCustom: (v: string) => void;
    setHasPack: (v: boolean) => void;
    setPackKind: (v: PackKind) => void;
    setPackCustom: (v: string) => void;
    setPiecesPerPack: (v: string) => void;
    setStockCount: (v: string) => void;
    setSellPrice: (v: string) => void;
    setBuyPackPrice: (v: string) => void;
    setSavedFlash: (v: boolean) => void;
  },
) {
  setters.setName(prefill.name ?? "");
  setters.setShelf((prefill.shelf ?? "").trim());
  setters.setSellUnit(prefill.sellUnit ?? "piece");
  setters.setSellUnitCustom(prefill.sellUnitCustom ?? "");
  setters.setHasPack(prefill.hasPack ?? false);
  setters.setPackKind(prefill.packKind ?? "crate");
  setters.setPackCustom(prefill.packCustom ?? "");
  setters.setPiecesPerPack(prefill.piecesPerPack ?? "");
  setters.setStockCount(prefill.stockCount ?? "");
  setters.setSellPrice(prefill.sellPrice ?? "");
  setters.setBuyPackPrice(prefill.buyPackPrice ?? "");
  setters.setSavedFlash(false);
}

export function SimpleAddProductWizard({
  lang,
  open,
  onClose,
  shelves,
  generalCategoryLabel,
  disabled,
  onSave,
  prefill,
  initialStep,
  editingProduct = null,
}: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [shelf, setShelf] = useState("");
  const [sellUnit, setSellUnit] = useState<SellUnitKind>("piece");
  const [sellUnitCustom, setSellUnitCustom] = useState("");
  const [hasPack, setHasPack] = useState(false);
  const [packKind, setPackKind] = useState<PackKind>("crate");
  const [packCustom, setPackCustom] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [stockCount, setStockCount] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [auditReason, setAuditReason] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isEdit = editingProduct != null;

  const unitLabel = sellUnitLabel(sellUnit, lang, sellUnitCustom);
  const packLabel = packKindLabel(packKind, packCustom, lang);
  const piecesN = useMemo(() => {
    if (!hasPack) return 1;
    return Math.max(1, Math.floor(Number(piecesPerPack.replace(/[^\d.]/g, "")) || 0));
  }, [hasPack, piecesPerPack]);
  const packPriceN = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
  const sellPriceN = Math.floor(Number(sellPrice.replace(/\D/g, "")) || 0);
  const stockN = Math.max(0, Number(stockCount.replace(/[^\d.]/g, "")) || 0);
  const totalPieces = hasPack ? stockN * piecesN : stockN;

  const activeStepIndex = Math.max(0, STEPS.indexOf(step));
  const needsAuditReason = useMemo(() => {
    if (!editingProduct) return false;
    const priceChanged = sellPriceN !== Math.floor(editingProduct.sellingPricePerUnitUgx);
    const stockChanged = totalPieces !== Math.floor(editingProduct.stockOnHand);
    return priceChanged || stockChanged;
  }, [editingProduct, sellPriceN, totalPieces]);

  const reset = () => {
    setStep("name");
    setName("");
    setShelf("");
    setSellUnit("piece");
    setSellUnitCustom("");
    setHasPack(false);
    setPackKind("crate");
    setPackCustom("");
    setPiecesPerPack("");
    setStockCount("");
    setSellPrice("");
    setBuyPackPrice("");
    setAuditReason("");
    setSavedFlash(false);
    setSaveError(null);
  };

  useEffect(() => {
    if (!open) return;
    if (prefill) {
      applyWizardPrefill(prefill, shelves, {
        setName,
        setShelf,
        setSellUnit,
        setSellUnitCustom,
        setHasPack,
        setPackKind,
        setPackCustom,
        setPiecesPerPack,
        setStockCount,
        setSellPrice,
        setBuyPackPrice,
        setSavedFlash,
      });
      setStep(initialStep ?? "name");
      setSaveError(null);
      return;
    }
    reset();
  }, [open, prefill, initialStep, shelves]);

  const shelfValue = shelf.trim() || generalCategoryLabel;
  const isLastStep = step === "buyPrice";

  const canNext = (): boolean => {
    switch (step) {
      case "name":
        return name.trim().length > 0;
      case "shelf":
        return shelf.trim().length > 0 || shelves.length === 0;
      case "sellUnit":
        return sellUnit !== "custom" || sellUnitCustom.trim().length > 0;
      case "pack":
        return hasPack ? packKind !== "custom" || packCustom.trim().length > 0 : true;
      case "piecesPerPack":
        return hasPack ? piecesN > 0 : true;
      case "stock":
        return true;
      case "sellPrice":
        return sellPriceN > 0;
      case "buyPrice":
        return !needsAuditReason || validateAuditReason(auditReason);
      default:
        return false;
    }
  };

  const handleSave = (addAnother: boolean) => {
    const built = buildProductFromSimpleWizard(
      {
        name,
        shelf: shelfValue,
        sellUnit,
        sellUnitCustom,
        hasPack,
        packKind,
        packCustom,
        piecesPerPack,
        stockCount,
        sellPriceUgx: sellPrice,
        buyPackPriceUgx: buyPackPrice,
      },
      lang,
    );
    if (!built) {
      setSaveError(t(lang, "invalid"));
      return;
    }
    const ok = onSave(built, needsAuditReason ? { auditReason } : undefined);
    if (!ok) {
      setSaveError(
        needsAuditReason && !validateAuditReason(auditReason)
          ? t(lang, "auditReasonRequired")
          : t(lang, "invalid"),
      );
      return;
    }
    setSaveError(null);
    if (addAnother) {
      setSavedFlash(true);
      setName("");
      setShelf("");
      setSellUnit("piece");
      setSellUnitCustom("");
      setHasPack(false);
      setPackKind("crate");
      setPackCustom("");
      setPiecesPerPack("");
      setStockCount("");
      setSellPrice("");
      setBuyPackPrice("");
      setStep("name");
      window.setTimeout(() => setSavedFlash(false), 2200);
      return;
    }
    onClose();
  };

  const goNext = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) {
      setSaveError(null);
      setStep(STEPS[i + 1]!);
    }
  };

  const goBack = () => {
    const i = STEPS.indexOf(step);
    if (i <= 0) return;
    setSaveError(null);
    setStep(STEPS[i - 1]!);
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (savedFlash) return;
    if (isLastStep) {
      if (!disabled && canNext()) handleSave(false);
      return;
    }
    if (canNext()) goNext();
  };

  const canGoBack = activeStepIndex > 0;
  const titleId = "simple-add-wizard-title";
  const descId = "simple-add-wizard-desc";

  return (
    <ProductWizardShell
      lang={lang}
      open={open}
      onClose={onClose}
      title={t(lang, isEdit ? "simpleAddEditTitle" : "simpleAddTitle")}
      titleId={titleId}
      descId={descId}
      stepIndex={activeStepIndex}
      totalSteps={TOTAL_STEPS}
      saveError={saveError}
      savedFlash={savedFlash}
      onSubmit={handleFormSubmit}
      footer={
        !savedFlash ? (
          <WizardFooter
            lang={lang}
            isLastStep={isLastStep}
            canGoBack={canGoBack}
            canProceed={canNext()}
            disabled={disabled}
            onBack={goBack}
            onPrimary={() => undefined}
            onAddAnother={() => handleSave(true)}
            isEdit={isEdit}
            showAddAnother={isLastStep && !isEdit}
          />
        ) : undefined
      }
    >
      {!savedFlash && step === "name" ? (
              <div key="name" className="wizard-step-enter space-y-5">
                <WizardStepHeading title={t(lang, "simpleAddStep1Title")} />
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaveError(null);
                  }}
                  placeholder={uiPlaceholder(
                    lang,
                    preferences.businessType,
                    "simpleAddStep1Example",
                    preferences.pharmacyModeEnabled,
                    preferences.hospitalityModeEnabled,
                  )}
                  autoFocus
                  autoComplete="off"
                  className={WIZARD_INPUT_TEXT}
                />
              </div>
            ) : null}

            {!savedFlash && step === "shelf" ? (
              <div key="shelf" className="wizard-step-enter space-y-5">
                <WizardStepHeading
                  title={t(lang, "simpleAddStep2Title")}
                  hint={uiPlaceholder(
                    lang,
                    preferences.businessType,
                    "simpleAddStep2Hint",
                    preferences.pharmacyModeEnabled,
                    preferences.hospitalityModeEnabled,
                  )}
                />
                <CategoryShelfPicker
                  lang={lang}
                  options={shelves}
                  value={shelf}
                  onChange={setShelf}
                  placeholder={uiPlaceholder(
                    lang,
                    preferences.businessType,
                    "simpleAddShelfPlaceholder",
                    preferences.pharmacyModeEnabled,
                    preferences.hospitalityModeEnabled,
                  )}
                  inputClass={WIZARD_INPUT_TEXT}
                />
              </div>
            ) : null}

            {!savedFlash && step === "sellUnit" ? (
              <div key="sellUnit" className="wizard-step-enter space-y-5">
                <WizardStepHeading title={t(lang, "simpleAddStep3Title")} hint={t(lang, "simpleAddStep3Hint")} />
                <div className="space-y-2.5">
                  {SELL_UNIT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSellUnit(opt.id)}
                      className={clsx(wizardChoiceButtonClass(sellUnit === opt.id), "flex w-full items-center px-4 text-lg")}
                    >
                      {t(lang, opt.labelKey as "sellUnit_piece")}
                    </button>
                  ))}
                  {sellUnit === "custom" ? (
                    <input
                      value={sellUnitCustom}
                      onChange={(e) => setSellUnitCustom(e.target.value)}
                      placeholder={t(lang, "simpleAddSellUnitCustomPh")}
                      autoFocus
                      className={clsx(WIZARD_INPUT_TEXT, "border-dashed text-lg font-bold")}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {!savedFlash && step === "pack" ? (
              <div key="pack" className="wizard-step-enter space-y-5">
                <WizardStepHeading
                  title={hasPack ? t(lang, "simpleAddStep4Title") : t(lang, "simpleAddPackTypeScreenTitle")}
                  hint={!hasPack ? t(lang, "simpleAddSoldIndividuallyDesc") : undefined}
                />
                <label className="flex min-h-[58px] cursor-pointer items-center gap-3.5 rounded-2xl border border-border bg-muted/30 px-4 shadow-sm transition-colors has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
                  <input
                    type="checkbox"
                    checked={hasPack}
                    onChange={(e) => setHasPack(e.target.checked)}
                    className="h-5 w-5 shrink-0 rounded-md accent-primary"
                  />
                  <span className="text-base font-black text-foreground">{t(lang, "simpleAddPackToggle")}</span>
                </label>
                {hasPack ? (
                  <>
                    <p className="text-sm font-bold text-muted-foreground">{t(lang, "simpleAddPackTypeLabel")}</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {PACK_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setPackKind(opt.id)}
                          className={wizardChoiceButtonClass(packKind === opt.id)}
                        >
                          {t(lang, opt.labelKey as "packKind_crate")}
                        </button>
                      ))}
                    </div>
                    {packKind === "custom" ? (
                      <input
                        value={packCustom}
                        onChange={(e) => setPackCustom(e.target.value)}
                        placeholder={t(lang, "simpleAddPackCustomPh")}
                        autoFocus
                        className={clsx(WIZARD_INPUT_TEXT, "border-dashed text-lg font-bold")}
                      />
                    ) : null}
                  </>
                ) : (
                  <WizardAutoConfiguredCard lang={lang} value={t(lang, "simpleAddPackTypeNotApplicable")} />
                )}
              </div>
            ) : null}

            {!savedFlash && step === "piecesPerPack" ? (
              <div key="piecesPerPack" className="wizard-step-enter space-y-5">
                {hasPack ? (
                  <>
                    <WizardStepHeading
                      title={tTemplate(lang, "simpleAddStep5Title", { unit: unitLabel, pack: packLabel })}
                      hint={tTemplate(lang, "simpleAddStep5Example", {
                        count: "24",
                        unit: unitLabel,
                        pack: packLabel,
                      })}
                    />
                    <input
                      value={piecesPerPack}
                      onChange={(e) => setPiecesPerPack(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
                      inputMode="numeric"
                      placeholder="24"
                      autoFocus
                      className={WIZARD_INPUT_NUMERIC}
                    />
                  </>
                ) : (
                  <>
                    <WizardStepHeading
                      title={t(lang, "simpleAddStep5TitleIndividual")}
                      hint={t(lang, "simpleAddStep5HintIndividual")}
                    />
                    <div
                      className={clsx(
                        WIZARD_INPUT_NUMERIC,
                        "flex items-center border-emerald-500/25 bg-emerald-500/5 text-foreground",
                      )}
                      aria-readonly
                    >
                      1
                    </div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
                      {t(lang, "simpleAddAutoConfigured")}
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {!savedFlash && step === "stock" ? (
              <div key="stock" className="wizard-step-enter space-y-5">
                <WizardStepHeading
                  title={
                    hasPack
                      ? tTemplate(lang, "simpleAddStep6TitlePack", { pack: packLabel })
                      : t(lang, "simpleAddStep6TitleLoose")
                  }
                  hint={t(lang, "simpleAddStep6Hint")}
                />
                <input
                  value={stockCount}
                  onChange={(e) => setStockCount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                  inputMode="decimal"
                  placeholder={hasPack ? "5" : "0"}
                  autoFocus
                  className={WIZARD_INPUT_NUMERIC}
                />
                {hasPack && piecesN > 0 && stockN > 0 ? (
                  <WizardInfoCard accent="brand">
                    {tTemplate(lang, "simpleAddStockSummary", {
                      packs: String(stockN),
                      packLabel,
                      total: String(totalPieces),
                      unit: unitLabel,
                    })}
                  </WizardInfoCard>
                ) : null}
              </div>
            ) : null}

            {!savedFlash && step === "sellPrice" ? (
              <div key="sellPrice" className="wizard-step-enter space-y-5">
                <WizardStepHeading title={tTemplate(lang, "simpleAddStep7Title", { unit: unitLabel })} />
                <div className="relative">
                  <input
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    placeholder="1000"
                    autoFocus
                    aria-invalid={sellPriceN <= 0 && sellPrice.length > 0}
                    className={clsx(WIZARD_INPUT_NUMERIC, "pr-16")}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    UGX
                  </span>
                </div>
                {hasPack && piecesN > 1 && sellPriceN > 0 ? (
                  <WizardInfoCard>
                    {tTemplate(lang, "simpleAddFullPackSellPrice", {
                      pack: packLabel,
                      amount: (sellPriceN * piecesN).toLocaleString(),
                    })}
                  </WizardInfoCard>
                ) : null}
                {hasPack && packPriceN > 0 && piecesN > 0 && sellPriceN > 0 ? (
                  <CostValidationPreview
                    lang={lang}
                    packCostUgx={packPriceN}
                    piecesPerPack={piecesN}
                    sellPriceUgx={sellPriceN}
                    packLabel={packLabel}
                    unitLabel={unitLabel}
                  />
                ) : null}
              </div>
            ) : null}

            {!savedFlash && step === "buyPrice" ? (
              <div key="buyPrice" className="wizard-step-enter space-y-5">
                <WizardStepHeading
                  title={
                    hasPack
                      ? tTemplate(lang, "simpleAddStep8Title", { pack: packLabel })
                      : tTemplate(lang, "simpleAddStep8TitleUnit", { unit: unitLabel })
                  }
                  hint={t(lang, "simpleAddStep8Hint")}
                />
                <div className="relative">
                  <input
                    value={buyPackPrice}
                    onChange={(e) => setBuyPackPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    placeholder="36000"
                    autoFocus
                    className={clsx(WIZARD_INPUT_NUMERIC, "pr-16")}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    UGX
                  </span>
                </div>
                <p className="text-sm font-semibold text-muted-foreground">{t(lang, "simpleAddStep8Optional")}</p>
                {hasPack && packPriceN > 0 && piecesN > 0 && sellPriceN > 0 ? (
                  <CostValidationPreview
                    lang={lang}
                    packCostUgx={packPriceN}
                    piecesPerPack={piecesN}
                    sellPriceUgx={sellPriceN}
                    packLabel={packLabel}
                    unitLabel={unitLabel}
                  />
                ) : null}
                {!hasPack && packPriceN > 0 && sellPriceN > 0 ? (
                  <CostValidationPreview
                    lang={lang}
                    unitCostUgx={packPriceN}
                    sellPriceUgx={sellPriceN}
                    unitLabel={unitLabel}
                  />
                ) : null}
                {isLastStep && needsAuditReason ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-bold text-foreground">{t(lang, "auditReasonLabel")}</span>
                    <textarea
                      value={auditReason}
                      onChange={(e) => setAuditReason(e.target.value)}
                      className="min-h-[80px] w-full rounded-2xl border border-input bg-card px-3 py-2.5 text-sm font-semibold text-foreground shadow-sm outline-none transition-[border-color,box-shadow] focus:border-primary/50 focus:ring-2 focus:ring-ring/25"
                      placeholder={t(lang, "auditReasonPlaceholder")}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
    </ProductWizardShell>
  );
}
