import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Package, X } from "lucide-react";
import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { shelfIconFor } from "../../lib/productCategories";
import { uiPlaceholder } from "../../lib/pharmacyUx";
import { usePosStore } from "../../store/usePosStore";
import { AppModalOverlay } from "../layout/AppModalOverlay";
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

const STEPS: Step[] = ["name", "shelf", "sellUnit", "pack", "piecesPerPack", "stock", "sellPrice", "buyPrice"];

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

const INPUT_BASE =
  "min-h-[58px] w-full rounded-2xl border border-input bg-card px-4 text-foreground shadow-sm outline-none transition-[border-color,box-shadow,transform] duration-200 placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-ring/25 motion-reduce:transition-none";

const INPUT_TEXT = clsx(INPUT_BASE, "text-xl font-bold tracking-tight");
const INPUT_NUMERIC = clsx(INPUT_BASE, "text-3xl font-black tabular-nums tracking-tight");

const BTN_FOOTER_BASE =
  "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl text-base font-black transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 motion-reduce:active:scale-100 motion-reduce:transition-none";

function WizardInfoCard({ children, accent }: { children: ReactNode; accent?: "brand" | "neutral" }) {
  return (
    <div
      className={clsx(
        "rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm",
        accent === "brand"
          ? "border-primary/20 bg-primary/5 text-foreground dark:border-primary/30 dark:bg-primary/10"
          : "border-border/70 bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

function WizardStepHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-[1.625rem] font-black leading-tight tracking-tight text-foreground">{title}</h2>
      {hint ? <p className="text-base leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

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

function choiceButtonClass(selected: boolean) {
  return clsx(
    "min-h-[56px] rounded-2xl border px-3 text-base font-black transition-all duration-200",
    "active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    selected
      ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/15"
      : "border-border bg-card text-foreground shadow-sm hover:border-primary/30 hover:bg-muted/30",
  );
}

function applyWizardPrefill(
  prefill: SimpleAddWizardPrefill,
  shelves: string[],
  setters: {
    setName: (v: string) => void;
    setShelfPick: (v: string) => void;
    setShelfNew: (v: string) => void;
    setCreatingShelf: (v: boolean) => void;
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
  const shelf = (prefill.shelf ?? "").trim();
  const shelfMatch = shelf
    ? shelves.find((s) => s.trim().toLowerCase() === shelf.toLowerCase())
    : undefined;
  if (shelfMatch) {
    setters.setShelfPick(shelfMatch);
    setters.setShelfNew("");
    setters.setCreatingShelf(false);
  } else if (shelf) {
    setters.setShelfPick("");
    setters.setShelfNew(shelf);
    setters.setCreatingShelf(true);
  } else {
    setters.setShelfPick("");
    setters.setShelfNew("");
    setters.setCreatingShelf(shelves.length === 0);
  }
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
  const [shelfPick, setShelfPick] = useState("");
  const [shelfNew, setShelfNew] = useState("");
  const [creatingShelf, setCreatingShelf] = useState(false);
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
  const progressPct = ((activeStepIndex + 1) / TOTAL_STEPS) * 100;

  const needsAuditReason = useMemo(() => {
    if (!editingProduct) return false;
    const priceChanged = sellPriceN !== Math.floor(editingProduct.sellingPricePerUnitUgx);
    const stockChanged = totalPieces !== Math.floor(editingProduct.stockOnHand);
    return priceChanged || stockChanged;
  }, [editingProduct, sellPriceN, totalPieces]);

  const reset = () => {
    setStep("name");
    setName("");
    setShelfPick("");
    setShelfNew("");
    setCreatingShelf(false);
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
        setShelfPick,
        setShelfNew,
        setCreatingShelf,
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

  useEffect(() => {
    if (step === "shelf" && shelves.length === 0) setCreatingShelf(true);
  }, [step, shelves.length]);

  const shelfValue = creatingShelf ? shelfNew.trim() : shelfPick.trim() || generalCategoryLabel;
  const isLastStep = step === "buyPrice";

  const canNext = (): boolean => {
    switch (step) {
      case "name":
        return name.trim().length > 0;
      case "shelf":
        return creatingShelf ? shelfNew.trim().length > 0 : shelfPick.trim().length > 0 || shelves.length === 0;
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
      setShelfPick("");
      setShelfNew("");
      setCreatingShelf(shelves.length === 0);
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

  if (!open) return null;

  const canGoBack = activeStepIndex > 0;
  const titleId = "simple-add-wizard-title";
  const descId = "simple-add-wizard-desc";

  return (
    <AppModalOverlay
      className="z-[56] flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClick={onClose}
    >
      <div
        className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-border/60 bg-card shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="shrink-0 border-b border-border/60 bg-card/95 px-4 pb-4 pt-4 backdrop-blur-md sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
              <Package className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p id={descId} className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {tTemplate(lang, "simpleAddStepOf", {
                  n: String(activeStepIndex + 1),
                  total: String(TOTAL_STEPS),
                })}
              </p>
              <h2 id={titleId} className="truncate text-lg font-black tracking-tight text-foreground">
                {t(lang, isEdit ? "simpleAddEditTitle" : "simpleAddTitle")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t(lang, "cancel")}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={activeStepIndex + 1}
              aria-valuemin={1}
              aria-valuemax={TOTAL_STEPS}
              aria-label={tTemplate(lang, "simpleAddStepOf", {
                n: String(activeStepIndex + 1),
                total: String(TOTAL_STEPS),
              })}
            />
          </div>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleFormSubmit} noValidate>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
            {saveError ? (
              <div
                className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive dark:text-red-300"
                role="alert"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p>{saveError}</p>
              </div>
            ) : null}

            {savedFlash ? (
              <div
                className="wizard-success-enter flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-6 py-8 text-center"
                role="status"
              >
                <span className="wizard-check-pop flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-8 w-8" strokeWidth={2.25} aria-hidden />
                </span>
                <p className="text-lg font-black text-emerald-900 dark:text-emerald-100">{t(lang, "simpleAddSaved")}</p>
              </div>
            ) : null}

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
                  className={INPUT_TEXT}
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
                {shelves.length > 0 && !creatingShelf ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {shelves.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setShelfPick(s)}
                        className={clsx(
                          choiceButtonClass(shelfPick === s),
                          "flex items-center justify-center gap-2 px-3",
                        )}
                      >
                        {shelfIconFor(s) ? <span aria-hidden>{shelfIconFor(s)}</span> : null}
                        <span className="truncate">{s}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {creatingShelf || shelves.length === 0 ? (
                  <input
                    value={shelfNew}
                    onChange={(e) => setShelfNew(e.target.value)}
                    placeholder={uiPlaceholder(
                      lang,
                      preferences.businessType,
                      "simpleAddShelfPlaceholder",
                      preferences.pharmacyModeEnabled,
                      preferences.hospitalityModeEnabled,
                    )}
                    autoFocus
                    autoComplete="off"
                    className={INPUT_TEXT}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingShelf(true);
                      setShelfPick("");
                    }}
                    className="w-full min-h-[52px] rounded-2xl border-2 border-dashed border-primary/35 bg-primary/5 py-3 text-base font-black text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
                  >
                    {t(lang, "simpleAddNewShelf")}
                  </button>
                )}
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
                      className={clsx(choiceButtonClass(sellUnit === opt.id), "flex w-full items-center px-4 text-lg")}
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
                      className={clsx(INPUT_BASE, "border-dashed text-lg font-bold")}
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
                          className={choiceButtonClass(packKind === opt.id)}
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
                        className={clsx(INPUT_BASE, "border-dashed text-lg font-bold")}
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
                      className={INPUT_NUMERIC}
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
                        INPUT_NUMERIC,
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
                  className={INPUT_NUMERIC}
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
                    className={clsx(INPUT_NUMERIC, "pr-16")}
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
                    className={clsx(INPUT_NUMERIC, "pr-16")}
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
          </div>

          {/* Sticky footer */}
          {!savedFlash ? (
            <footer className="shrink-0 border-t border-border/60 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5">
              {isLastStep ? (
                <div className="space-y-2.5">
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={goBack}
                      disabled={!canGoBack}
                      className={clsx(
                        BTN_FOOTER_BASE,
                        "min-w-[52px] shrink-0 border border-border bg-card px-4 text-foreground shadow-sm hover:bg-muted",
                      )}
                      aria-label={t(lang, "simpleAddBack")}
                    >
                      <ChevronLeft className="h-5 w-5" aria-hidden />
                    </button>
                    <button
                      type="submit"
                      disabled={disabled || !canNext()}
                      className={clsx(
                        BTN_FOOTER_BASE,
                        "flex-1 bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
                      )}
                    >
                      {t(lang, isEdit ? "simpleAddSaveChanges" : "simpleAddSave")}
                    </button>
                  </div>
                  {!isEdit ? (
                    <button
                      type="button"
                      disabled={disabled || !canNext()}
                      onClick={() => handleSave(true)}
                      className={clsx(
                        BTN_FOOTER_BASE,
                        "w-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10",
                      )}
                    >
                      {t(lang, "simpleAddAddAnother")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={!canGoBack}
                    className={clsx(
                      BTN_FOOTER_BASE,
                      "min-w-[52px] shrink-0 border border-border bg-card px-4 text-foreground shadow-sm hover:bg-muted",
                    )}
                    aria-label={t(lang, "simpleAddBack")}
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="submit"
                    disabled={!canNext()}
                    className={clsx(
                      BTN_FOOTER_BASE,
                      "flex-1 bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90",
                    )}
                  >
                    {t(lang, "simpleAddNext")}
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              )}
            </footer>
          ) : null}
        </form>
      </div>
    </AppModalOverlay>
  );
}
