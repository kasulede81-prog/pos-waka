import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { shelfIconFor } from "../../lib/productCategories";
import { wizardChoiceButtonClass } from "./wizard/wizardTokens";

export function categoryShelfPickFromValue(
  value: string,
  options: string[],
): { pick: string; custom: string; isOther: boolean } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { pick: "", custom: "", isOther: options.length === 0 };
  }
  const match = options.find((o) => o.trim().toLowerCase() === trimmed.toLowerCase());
  if (match) return { pick: match, custom: "", isOther: false };
  return { pick: "", custom: trimmed, isOther: true };
}

export function resolveCategoryShelfValue(pick: string, custom: string, isOther: boolean): string {
  return isOther ? custom.trim() : pick.trim();
}

type EntryMode = "choose" | "existing" | "new";

function inferEntryMode(value: string, options: string[]): EntryMode {
  const { pick, custom, isOther } = categoryShelfPickFromValue(value, options);
  if (pick) return "existing";
  if (isOther && custom.trim()) return "new";
  if (options.length === 0) return "new";
  return "choose";
}

type Props = {
  lang: Language;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  inputClass?: string;
  showHint?: boolean;
  /** Ask "existing" vs "new" before showing the category grid or text field. */
  requireModeChoice?: boolean;
};

export function CategoryShelfPicker({
  lang,
  options,
  value,
  onChange,
  placeholder,
  hint,
  inputClass,
  showHint = true,
  requireModeChoice = false,
}: Props) {
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const [isOther, setIsOther] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("choose");

  useEffect(() => {
    const next = categoryShelfPickFromValue(value, options);
    setPick(next.pick);
    setCustom(next.custom);
    setIsOther(next.isOther);
    if (requireModeChoice) {
      setEntryMode(inferEntryMode(value, options));
    }
  }, [value, options, requireModeChoice]);

  const emit = (nextPick: string, nextCustom: string, nextOther: boolean) => {
    onChange(resolveCategoryShelfValue(nextPick, nextCustom, nextOther));
  };

  const showCustomInput = isOther || options.length === 0;
  const useModeChoice = requireModeChoice && options.length > 0;
  const showChooseScreen = useModeChoice && entryMode === "choose";
  const showExistingGrid = !useModeChoice || entryMode === "existing";
  const showNewInput = showCustomInput && (!useModeChoice || entryMode === "new");

  const backToChoose = () => {
    setEntryMode("choose");
    setPick("");
    setCustom("");
    setIsOther(false);
    onChange("");
  };

  const chooseExisting = () => {
    setEntryMode("existing");
    setPick("");
    setCustom("");
    setIsOther(false);
    onChange("");
  };

  const chooseNew = () => {
    setEntryMode("new");
    setPick("");
    setCustom("");
    setIsOther(true);
    onChange("");
  };

  return (
    <div className="space-y-3">
      {showChooseScreen ? (
        <div className="grid gap-2.5">
          <button type="button" onClick={chooseExisting} className={wizardChoiceButtonClass(false)}>
            {t(lang, "categoryChooseExisting")}
          </button>
          <button type="button" onClick={chooseNew} className={wizardChoiceButtonClass(false)}>
            {t(lang, "categoryCreateNew")}
          </button>
        </div>
      ) : null}

      {useModeChoice && entryMode !== "choose" ? (
        <button
          type="button"
          onClick={backToChoose}
          className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {t(lang, "categoryBackToOptions")}
        </button>
      ) : null}

      {showHint && options.length > 0 && showExistingGrid && !showChooseScreen ? (
        <p className="text-sm font-medium text-muted-foreground">{hint ?? t(lang, "categoryPickHint")}</p>
      ) : null}

      {options.length > 0 && showExistingGrid && !showChooseScreen ? (
        <div className="grid grid-cols-2 gap-2.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setPick(option);
                setIsOther(false);
                setCustom("");
                emit(option, "", false);
              }}
              className={clsx(
                wizardChoiceButtonClass(!isOther && pick === option),
                "flex items-center justify-center gap-2 px-3",
              )}
            >
              {shelfIconFor(option) ? <span aria-hidden>{shelfIconFor(option)}</span> : null}
              <span className="truncate">{option}</span>
            </button>
          ))}
          {!useModeChoice ? (
            <button
              type="button"
              onClick={() => {
                setPick("");
                setIsOther(true);
                emit("", custom, true);
              }}
              className={clsx(
                wizardChoiceButtonClass(isOther),
                "col-span-2 flex items-center justify-center px-3",
              )}
            >
              {t(lang, "categoryOther")}
            </button>
          ) : null}
        </div>
      ) : null}

      {showNewInput && !showChooseScreen ? (
        <input
          value={custom}
          onChange={(e) => {
            const next = e.target.value;
            setCustom(next);
            emit(pick, next, true);
          }}
          placeholder={placeholder}
          autoFocus={isOther || entryMode === "new"}
          autoComplete="off"
          className={inputClass}
        />
      ) : null}
    </div>
  );
}
