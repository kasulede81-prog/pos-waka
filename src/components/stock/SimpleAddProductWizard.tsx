import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { shelfIconFor } from "../../lib/productCategories";
import {
  BUY_PACK_OPTIONS,
  COMMON_PRODUCT_CHIPS,
  buildProductFromSimpleWizard,
  estimateSellOptionProfitUgx,
  hintForProductName,
  wizardCostPerSellUnitUgx,
  type BuiltWizardProduct,
  type BuyPackKind,
  type WizardSellOption,
  buyLabelForKind,
} from "../../lib/simpleProductWizard";

type Step = "name" | "buyHow" | "inside" | "buyPrice" | "stock" | "sell" | "shelf";

const STEPS: Step[] = ["name", "buyHow", "buyPrice", "inside", "stock", "sell", "shelf"];

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  shelves: string[];
  generalCategoryLabel: string;
  disabled?: boolean;
  onSave: (payload: BuiltWizardProduct | null) => boolean;
};

function emptySellOptions(): WizardSellOption[] {
  return [{ label: "", priceUgx: "" }];
}

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
  const [buyHow, setBuyHow] = useState<BuyPackKind | null>(null);
  const [buyCustom, setBuyCustom] = useState("");
  const [piecesInside, setPiecesInside] = useState("");
  const [buyPackPrice, setBuyPackPrice] = useState("");
  const [stockPacks, setStockPacks] = useState("");
  const [sellOptions, setSellOptions] = useState<WizardSellOption[]>(emptySellOptions);
  const [shelfPick, setShelfPick] = useState("");
  const [shelfNew, setShelfNew] = useState("");
  const [creatingShelf, setCreatingShelf] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [hintTouched, setHintTouched] = useState(false);

  const hint = useMemo(() => hintForProductName(name), [name]);
  const buyUnitLabel = buyHow ? buyLabelForKind(buyHow, buyCustom, lang) : "";
  const packPriceN = Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0);
  const piecesN = useMemo(() => {
    if (!buyHow) return 0;
    if (buyHow === "kg" || buyHow === "piece") return 1;
    const n = Math.floor(Number(piecesInside.replace(/[^\d.]/g, "")) || 0);
    return n > 0 ? n : hint?.piecesInside ?? 0;
  }, [buyHow, piecesInside, hint?.piecesInside]);
  const costPerPieceUgx = useMemo(
    () => (buyHow ? wizardCostPerSellUnitUgx(packPriceN, piecesN, buyHow) : null),
    [buyHow, packPriceN, piecesN],
  );
  const sellPieceLabel = hint?.sellBaseUnit ?? (buyHow === "bottle" ? "bottle" : buyHow === "kg" ? "kg" : "piece");

  const reset = () => {
    setStep("name");
    setName("");
    setBuyHow(null);
    setBuyCustom("");
    setPiecesInside("");
    setBuyPackPrice("");
    setStockPacks("");
    setSellOptions(emptySellOptions());
    setShelfPick("");
    setShelfNew("");
    setCreatingShelf(false);
    setSupplier("");
    setAdvancedOpen(false);
    setSavedFlash(false);
    setHintTouched(false);
  };

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open]);

  useEffect(() => {
    if (step === "shelf" && shelves.length === 0) setCreatingShelf(true);
  }, [step, shelves.length]);

  useEffect(() => {
    if (hintTouched || !hint) return;
    setBuyHow(hint.buyHow);
    setPiecesInside(String(hint.piecesInside));
    if (hint.defaultSellOptions.length) setSellOptions(hint.defaultSellOptions.map((o) => ({ ...o })));
  }, [hint, hintTouched]);

  const stepIndex = STEPS.indexOf(step);

  const goNext = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!);
  };

  const goBack = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]!);
  };

  const canNext = (): boolean => {
    switch (step) {
      case "name":
        return name.trim().length > 0;
      case "buyHow":
        return buyHow !== null && (buyHow !== "custom" || buyCustom.trim().length > 0);
      case "inside":
        return buyHow === "kg" || buyHow === "piece" || Number(piecesInside) > 0;
      case "buyPrice":
        return Math.floor(Number(buyPackPrice.replace(/\D/g, "")) || 0) > 0;
      case "stock":
        return true;
      case "sell":
        return sellOptions.some((o) => Math.floor(Number(o.priceUgx.replace(/\D/g, "")) || 0) > 0);
      case "shelf":
        return creatingShelf ? shelfNew.trim().length > 0 : shelfPick.trim().length > 0 || shelves.length === 0;
      default:
        return false;
    }
  };

  const shelfValue = creatingShelf ? shelfNew.trim() : shelfPick.trim() || generalCategoryLabel;

  const handleSave = (addAnother: boolean) => {
    if (!buyHow) return;
    const built = buildProductFromSimpleWizard(
      {
        name,
        buyHow,
        buyCustom,
        piecesInside,
        buyPackPriceUgx: buyPackPrice,
        stockPacks,
        sellOptions,
        shelf: shelfValue,
        supplier: advancedOpen ? supplier : undefined,
      },
      lang,
    );
    if (!built) return;
    const ok = onSave(built);
    if (!ok) return;
    if (addAnother) {
      setSavedFlash(true);
      setName("");
      setBuyHow(null);
      setBuyCustom("");
      setPiecesInside("");
      setBuyPackPrice("");
      setStockPacks("0");
      setSellOptions(emptySellOptions());
      setHintTouched(false);
      setStep("name");
      window.setTimeout(() => setSavedFlash(false), 1800);
      return;
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center"
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
                className={`h-2 rounded-full transition-all ${i <= stepIndex ? "w-6 bg-waka-600" : "w-2 bg-slate-200"}`}
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
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep1Title")}</h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep1Hint")}</p>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setHintTouched(false);
                }}
                placeholder={t(lang, "simpleAddStep1Example")}
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-xl font-bold outline-none ring-waka-300 focus:ring"
              />
              {hint?.suggestLineKey ? (
                <p className="rounded-xl bg-waka-50 px-3 py-2 text-sm font-bold text-waka-900">
                  {t(lang, hint.suggestLineKey)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {COMMON_PRODUCT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setName(chip);
                      setHintTouched(false);
                    }}
                    className="min-h-[44px] rounded-2xl border-2 border-waka-200 bg-waka-50 px-4 text-base font-black text-waka-950 active:bg-waka-100"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === "buyHow" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep2Title")}</h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep2Hint")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BUY_PACK_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setBuyHow(opt.id);
                      setHintTouched(true);
                      if (opt.id === "kg" || opt.id === "piece") setPiecesInside("1");
                    }}
                    className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 py-3 text-center font-black transition active:scale-[0.98] ${
                      buyHow === opt.id
                        ? "border-waka-500 bg-waka-600 text-white shadow-md"
                        : "border-slate-200 bg-white text-slate-900"
                    }`}
                  >
                    <span className="text-2xl" aria-hidden>
                      {opt.icon}
                    </span>
                    <span className="text-sm leading-tight">{t(lang, opt.labelKey as "buyHow_tray")}</span>
                  </button>
                ))}
              </div>
              {buyHow === "custom" ? (
                <input
                  value={buyCustom}
                  onChange={(e) => setBuyCustom(e.target.value)}
                  placeholder={t(lang, "bulkAddUnitCustomPlaceholder")}
                  className="min-h-[52px] w-full rounded-2xl border-2 border-dashed border-waka-300 px-4 text-lg font-bold"
                />
              ) : null}
            </div>
          ) : null}

          {step === "buyPrice" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">
                {tTemplate(lang, "simpleAddStep3Title", { unit: buyUnitLabel })}
              </h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep3Hint")}</p>
              {hint?.suggestLineKey === "simpleAddHintEggs" ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
                  {t(lang, "simpleAddBuyPriceExampleEggs")}
                </p>
              ) : hint?.suggestLineKey === "simpleAddHintSoda" ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
                  {t(lang, "simpleAddBuyPriceExampleSoda")}
                </p>
              ) : (
                <p className="text-sm font-semibold text-slate-500">{t(lang, "simpleAddBuyPriceExampleGeneric")}</p>
              )}
              <input
                value={buyPackPrice}
                onChange={(e) => setBuyPackPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder={hint?.suggestLineKey === "simpleAddHintEggs" ? "12000" : "12000"}
                autoFocus
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
              />
              <p className="text-sm font-semibold text-slate-500">UGX · {t(lang, "simpleAddBuyPriceWholeUnit")}</p>
            </div>
          ) : null}

          {step === "inside" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep4Title")}</h2>
              <p className="text-base text-slate-600">
                {buyHow === "kg"
                  ? t(lang, "simpleAddStep4SkipKg")
                  : tTemplate(lang, "simpleAddStep4Hint", { unit: buyUnitLabel })}
              </p>
              {packPriceN > 0 ? (
                <p className="rounded-xl bg-waka-50 px-3 py-2 text-sm font-bold text-waka-900">
                  {tTemplate(lang, "simpleAddPaidForUnit", {
                    amount: packPriceN.toLocaleString(),
                    unit: buyUnitLabel,
                  })}
                </p>
              ) : null}
              {buyHow !== "kg" && buyHow !== "piece" ? (
                <>
                  <input
                    value={piecesInside}
                    onChange={(e) => {
                      setPiecesInside(e.target.value.replace(/[^\d.]/g, "").slice(0, 6));
                      setHintTouched(true);
                    }}
                    inputMode="numeric"
                    placeholder={hint ? String(hint.piecesInside) : "30"}
                    autoFocus
                    className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
                  />
                  <p className="text-sm font-semibold text-slate-500">
                    {tTemplate(lang, "simpleAddStep4Example", {
                      count: piecesInside || String(hint?.piecesInside ?? "30"),
                      thing: name.trim() || t(lang, "simpleAddStep1Example"),
                      unit: buyUnitLabel,
                    })}
                  </p>
                  {costPerPieceUgx != null && costPerPieceUgx > 0 ? (
                    <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
                      {tTemplate(lang, "simpleAddCostPerPiece", {
                        piece: sellPieceLabel,
                        amount: costPerPieceUgx.toLocaleString(),
                      })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                  {buyHow === "kg" ? t(lang, "simpleAddStep4SkipKg") : t(lang, "simpleAddStep4OnePiece")}
                </p>
              )}
            </div>
          ) : null}

          {step === "stock" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">
                {tTemplate(lang, "simpleAddStep5Title", { unit: buyUnitLabel })}
              </h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep5Hint")}</p>
              <input
                value={stockPacks}
                onChange={(e) => setStockPacks(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                inputMode="decimal"
                placeholder="0"
                className="min-h-[56px] w-full rounded-2xl border-2 border-slate-200 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
              />
            </div>
          ) : null}

          {step === "sell" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddStep6Title")}</h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddStep6Hint")}</p>
              <div className="space-y-2">
                {sellOptions.map((opt, i) => (
                  <div key={i} className="rounded-2xl border-2 border-slate-100 bg-slate-50/80 p-3">
                    <input
                      value={opt.label}
                      onChange={(e) =>
                        setSellOptions((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                      }
                      placeholder={t(lang, "simpleAddSellLabelPh")}
                      className="mb-2 min-h-[44px] w-full rounded-xl border-2 border-slate-200 px-3 text-base font-bold"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        value={opt.priceUgx}
                        onChange={(e) =>
                          setSellOptions((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, priceUgx: e.target.value.replace(/\D/g, "") } : r)),
                          )
                        }
                        inputMode="numeric"
                        placeholder="UGX"
                        className="min-h-[48px] flex-1 rounded-xl border-2 border-slate-200 px-3 text-xl font-black"
                      />
                      {sellOptions.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setSellOptions((rows) => rows.filter((_, j) => j !== i))}
                          className="rounded-xl px-3 py-2 text-sm font-bold text-red-700"
                        >
                          {t(lang, "simpleAddRemoveSell")}
                        </button>
                      ) : null}
                    </div>
                    {buyHow && packPriceN > 0 && piecesN > 0 ? (() => {
                      const profit = estimateSellOptionProfitUgx({
                        buyHow,
                        packPriceUgx: packPriceN,
                        piecesInside: piecesN,
                        option: opt,
                      });
                      if (profit == null) return null;
                      return (
                        <p
                          className={clsx(
                            "mt-2 text-sm font-bold",
                            profit >= 0 ? "text-emerald-800" : "text-rose-800",
                          )}
                        >
                          {tTemplate(lang, "simpleAddSellProfitPreview", {
                            profit: profit.toLocaleString(),
                          })}
                        </p>
                      );
                    })() : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSellOptions((rows) => [...rows, { label: "", priceUgx: "" }])}
                className="w-full min-h-[48px] rounded-2xl border-2 border-dashed border-waka-300 py-3 text-base font-black text-waka-800"
              >
                {t(lang, "simpleAddAnotherSell")}
              </button>
            </div>
          ) : null}

          {step === "shelf" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-black text-slate-900">{t(lang, "simpleAddShelfTitle")}</h2>
              <p className="text-base text-slate-600">{t(lang, "simpleAddShelfHint")}</p>
              {shelves.length > 0 && !creatingShelf ? (
                <div className="grid grid-cols-2 gap-2">
                  {shelves.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setShelfPick(s)}
                      className={`flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-2 px-3 text-base font-black ${
                        shelfPick === s
                          ? "border-waka-500 bg-waka-600 text-white"
                          : "border-slate-200 bg-white text-slate-900"
                      }`}
                    >
                      {shelfIconFor(s) ? <span>{shelfIconFor(s)}</span> : null}
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {creatingShelf || shelves.length === 0 ? (
                <label className="block">
                  <span className="text-sm font-bold text-slate-800">{t(lang, "simpleAddNewShelf")}</span>
                  <input
                    value={shelfNew}
                    onChange={(e) => setShelfNew(e.target.value)}
                    placeholder={t(lang, "simpleAddShelfPlaceholder")}
                    autoFocus
                    className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-lg font-bold"
                  />
                </label>
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

              <details
                className="rounded-2xl border border-slate-200 bg-slate-50/50 px-3 open:pb-3"
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer py-3 text-sm font-black text-slate-700 marker:hidden [&::-webkit-details-marker]:hidden">
                  {t(lang, "simpleAddAdvanced")}
                </summary>
                <label className="block text-sm font-bold text-slate-800">
                  {t(lang, "supplierOptionalLabel")}
                  <input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder={t(lang, "supplierOptionalPh")}
                    className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 px-3 text-base"
                  />
                </label>
              </details>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-100 p-4 sm:p-5">
          {step === "shelf" ? (
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
    </div>
  );
}
