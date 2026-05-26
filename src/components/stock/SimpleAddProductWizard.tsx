import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { shelfIconFor } from "../../lib/productCategories";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import {
  PACK_TYPE_OPTIONS,
  SELL_UNIT_OPTIONS,
  buildProductFromSimpleWizard,
  packKindLabel,
  profitPerSellUnitUgx,
  sellUnitLabel,
  wizardCostPerSellUnitUgx,
  type BuiltWizardProduct,
  type PackKind,
  type SellUnitKind,
} from "../../lib/simpleProductWizard";

type Step = "name" | "shelf" | "sellUnit" | "pack" | "piecesPerPack" | "stock" | "sellPrice" | "buyPrice";

const STEPS: Step[] = ["name", "shelf", "sellUnit", "pack", "piecesPerPack", "stock", "sellPrice", "buyPrice"];

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  shelves: string[];
  generalCategoryLabel: string;
  disabled?: boolean;
  onSave: (payload: BuiltWizardProduct | null) => boolean;
};

export function SimpleAddProductWizard({
  lang,
  open,
  onClose,
  shelves,
  generalCategoryLabel,
  disabled,
  onSave,
}: Props) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [shelfPick, setShelfPick] = useState("");
  const [shelfNew, setShelfNew] = useState("");
  const [creatingShelf, setCreatingShelf] = useState(false);
  const [sellUnit, setSellUnit] = useState<SellUnitKind>("piece");
  const [hasPack, setHasPack] = useState(false);
  const [packKind, setPackKind] = useState<PackKind>("crate");
  const [packCustom, setPackCustom] = useState("");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [stockCount, setStockCount] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const unitLabel = sellUnitLabel(sellUnit, lang);
  const packLabel = packKindLabel(packKind, packCustom, lang);
  const piecesN = useMemo(() => {
    if (!hasPack) return 1;
    return Math.max(1, Math.floor(Number(piecesPerPack.replace(/[^\d.]/g, "")) || 0));
  }, [hasPack, piecesPerPack]);
  const packPriceN = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
  const sellPriceN = Math.floor(Number(sellPrice.replace(/\D/g, "")) || 0);
  const stockN = Math.max(0, Number(stockCount.replace(/[^\d.]/g, "")) || 0);
  const costPerUnit = wizardCostPerSellUnitUgx(packPriceN, piecesN);
  const profitPerUnit = profitPerSellUnitUgx(sellPriceN, costPerUnit);
  const totalPieces = hasPack ? stockN * piecesN : stockN;

  const reset = () => {
    setStep("name");
    setName("");
    setShelfPick("");
    setShelfNew("");
    setCreatingShelf(false);
    setSellUnit("piece");
    setHasPack(false);
    setPackKind("crate");
    setPackCustom("");
    setPiecesPerPack("");
    setStockCount("");
    setSellPrice("");
    setBuyPackPrice("");
    setSavedFlash(false);
  };

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open]);

  useEffect(() => {
    if (step === "shelf" && shelves.length === 0) setCreatingShelf(true);
  }, [step, shelves.length]);

  const stepIndex = STEPS.indexOf(step);
  const shelfValue = creatingShelf ? shelfNew.trim() : shelfPick.trim() || generalCategoryLabel;

  const goNext = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) {
      let next = STEPS[i + 1]!;
      if (next === "piecesPerPack" && !hasPack) next = "stock";
      if (next === "buyPrice" && !hasPack) return handleSave(false);
      setStep(next);
    }
  };

  const goBack = () => {
    const i = STEPS.indexOf(step);
    if (i <= 0) return;
    let prev = STEPS[i - 1]!;
    if (prev === "piecesPerPack" && !hasPack) prev = "pack";
    setStep(prev);
  };

  const canNext = (): boolean => {
    switch (step) {
      case "name":
        return name.trim().length > 0;
      case "shelf":
        return creatingShelf ? shelfNew.trim().length > 0 : shelfPick.trim().length > 0 || shelves.length === 0;
      case "sellUnit":
        return true;
      case "pack":
        return !hasPack || packKind !== "custom" || packCustom.trim().length > 0;
      case "piecesPerPack":
        return piecesN > 0;
      case "stock":
        return true;
      case "sellPrice":
        return sellPriceN > 0;
      case "buyPrice":
        return true;
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
    if (!built) return;
    const ok = onSave(built);
    if (!ok) return;
    if (addAnother) {
      setSavedFlash(true);
      setName("");
      setShelfPick("");
      setShelfNew("");
      setCreatingShelf(shelves.length === 0);
      setSellUnit("piece");
      setHasPack(false);
      setPackKind("crate");
      setPackCustom("");
      setPiecesPerPack("");
      setStockCount("");
      setSellPrice("");
      setBuyPackPrice("");
      setStep("name");
      window.setTimeout(() => setSavedFlash(false), 1800);
      return;
    }
    onClose();
  };

  if (!open) return null;

  const isLastStep = step === "buyPrice" || (step === "sellPrice" && !hasPack);

  return (
    <AppModalOverlay
      className="z-[56] flex items-end justify-center bg-black/55 sm:items-center"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-lg flex-col rounded-t-[1.75rem] bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 text-slate-700 active:bg-slate-50"
                aria-label={t(lang, "simpleAddBack")}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            ) : (
              <span className="w-11" />
            )}
            <div className="min-w-0 flex-1 text-center">
              <p className="text-xs font-bold uppercase tracking-wide text-waka-700">
                {tTemplate(lang, "simpleAddStepOf", { n: String(stepIndex + 1), total: String(STEPS.length) })}
              </p>
              <p className="truncate text-lg font-black text-slate-900">{t(lang, "simpleAddTitle")}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl px-2 py-1 text-sm font-bold text-slate-500"
            >
              {t(lang, "cancel")}
            </button>
          </div>
          <div className="mt-3 flex justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-2 rounded-full transition-all ${i <= stepIndex ? "w-5 bg-waka-600" : "w-2 bg-slate-200"}`}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {savedFlash ? (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-center text-lg font-black text-emerald-900">
              {t(lang, "simpleAddSaved")}
            </p>
          ) : null}

          {step === "name" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep1Title")}</h2>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(lang, "simpleAddStep1Example")}
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-xl font-bold outline-none ring-waka-300 focus:ring"
              />
            </div>
          ) : null}

          {step === "shelf" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep2Title")}</h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep2Hint")}</p>
              {shelves.length > 0 && !creatingShelf ? (
                <div className="grid grid-cols-2 gap-2">
                  {shelves.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setShelfPick(s)}
                      className={clsx(
                        "flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-2 px-3 text-base font-black",
                        shelfPick === s
                          ? "border-waka-500 bg-waka-600 text-white"
                          : "border-slate-200 bg-white text-slate-900",
                      )}
                    >
                      {shelfIconFor(s) ? <span>{shelfIconFor(s)}</span> : null}
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {creatingShelf || shelves.length === 0 ? (
                <input
                  value={shelfNew}
                  onChange={(e) => setShelfNew(e.target.value)}
                  placeholder={t(lang, "simpleAddShelfPlaceholder")}
                  autoFocus
                  className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-xl font-bold outline-none ring-waka-300 focus:ring"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingShelf(true);
                    setShelfPick("");
                  }}
                  className="w-full min-h-[48px] rounded-2xl border-2 border-waka-200 py-3 text-base font-black text-waka-900"
                >
                  {t(lang, "simpleAddNewShelf")}
                </button>
              )}
            </div>
          ) : null}

          {step === "sellUnit" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep3Title")}</h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep3Hint")}</p>
              <div className="space-y-2">
                {SELL_UNIT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSellUnit(opt.id)}
                    className={clsx(
                      "flex min-h-[56px] w-full items-center rounded-2xl border-2 px-4 text-lg font-black transition active:scale-[0.99]",
                      sellUnit === opt.id
                        ? "border-waka-500 bg-waka-600 text-white shadow-md"
                        : "border-slate-200 bg-white text-slate-900",
                    )}
                  >
                    {t(lang, opt.labelKey as "sellUnit_piece")}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === "pack" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep4Title")}</h2>
              <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl border-2 border-slate-200 bg-slate-50 px-4">
                <input
                  type="checkbox"
                  checked={hasPack}
                  onChange={(e) => setHasPack(e.target.checked)}
                  className="h-6 w-6 shrink-0 accent-waka-600"
                />
                <span className="text-base font-black text-slate-900">{t(lang, "simpleAddPackToggle")}</span>
              </label>
              {hasPack ? (
                <>
                  <p className="text-sm font-semibold text-slate-600">{t(lang, "simpleAddPackTypeLabel")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PACK_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPackKind(opt.id)}
                        className={clsx(
                          "min-h-[52px] rounded-2xl border-2 px-3 text-base font-black",
                          packKind === opt.id
                            ? "border-waka-500 bg-waka-600 text-white"
                            : "border-slate-200 bg-white text-slate-900",
                        )}
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
                      className="min-h-[52px] w-full rounded-2xl border-2 border-dashed border-waka-300 px-4 text-lg font-bold"
                    />
                  ) : null}
                </>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                  {t(lang, "simpleAddNoPackHint")}
                </p>
              )}
            </div>
          ) : null}

          {step === "piecesPerPack" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">
                {tTemplate(lang, "simpleAddStep5Title", { unit: unitLabel, pack: packLabel })}
              </h2>
              <p className="text-base text-slate-600">
                {tTemplate(lang, "simpleAddStep5Example", { count: "24", unit: unitLabel, pack: packLabel })}
              </p>
              <input
                value={piecesPerPack}
                onChange={(e) => setPiecesPerPack(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="24"
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
              />
            </div>
          ) : null}

          {step === "stock" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">
                {hasPack
                  ? tTemplate(lang, "simpleAddStep6TitlePack", { pack: packLabel })
                  : t(lang, "simpleAddStep6TitleLoose")}
              </h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep6Hint")}</p>
              <input
                value={stockCount}
                onChange={(e) => setStockCount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                inputMode="decimal"
                placeholder={hasPack ? "5" : "0"}
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
              />
              {hasPack && piecesN > 0 && stockN > 0 ? (
                <p className="rounded-xl bg-waka-50 px-3 py-2 text-sm font-bold text-waka-900">
                  {tTemplate(lang, "simpleAddStockSummary", {
                    packs: String(stockN),
                    packLabel,
                    total: String(totalPieces),
                    unit: unitLabel,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "sellPrice" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">
                {tTemplate(lang, "simpleAddStep7Title", { unit: unitLabel })}
              </h2>
              <input
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="1000"
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
              />
              <p className="text-sm font-semibold text-slate-500">UGX</p>
              {hasPack && piecesN > 1 && sellPriceN > 0 ? (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  {tTemplate(lang, "simpleAddFullPackSellPrice", {
                    pack: packLabel,
                    amount: (sellPriceN * piecesN).toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "buyPrice" ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-black text-slate-900">
                {tTemplate(lang, "simpleAddStep8Title", { pack: packLabel })}
              </h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep8Hint")}</p>
              <input
                value={buyPackPrice}
                onChange={(e) => setBuyPackPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="36000"
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
              />
              <p className="text-sm font-semibold text-slate-500">UGX · {t(lang, "simpleAddStep8Optional")}</p>
              {costPerUnit != null && costPerUnit > 0 ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
                  {tTemplate(lang, "simpleAddCostPerPiece", {
                    piece: unitLabel,
                    amount: costPerUnit.toLocaleString(),
                  })}
                </p>
              ) : null}
              {profitPerUnit != null && sellPriceN > 0 ? (
                <p
                  className={clsx(
                    "rounded-xl px-3 py-2 text-sm font-bold",
                    profitPerUnit >= 0 ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900",
                  )}
                >
                  {tTemplate(lang, "simpleAddProfitPerUnit", {
                    unit: unitLabel,
                    amount: profitPerUnit.toLocaleString(),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-100 p-4 sm:p-5">
          {isLastStep ? (
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                disabled={disabled || !canNext()}
                onClick={() => handleSave(false)}
                className="min-h-[56px] rounded-2xl bg-waka-600 text-xl font-black text-white shadow-md disabled:opacity-50"
              >
                {t(lang, "simpleAddSave")}
              </button>
              <button
                type="button"
                disabled={disabled || !canNext()}
                onClick={() => handleSave(true)}
                className="min-h-[48px] rounded-2xl border-2 border-waka-300 text-base font-black text-waka-900 disabled:opacity-50"
              >
                {t(lang, "simpleAddAddAnother")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!canNext()}
              onClick={goNext}
              className="min-h-[56px] w-full rounded-2xl bg-waka-600 text-xl font-black text-white shadow-md disabled:opacity-50"
            >
              {t(lang, "simpleAddNext")}
            </button>
          )}
        </div>
      </div>
    </AppModalOverlay>
  );
}
