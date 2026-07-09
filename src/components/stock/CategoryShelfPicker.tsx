import { useEffect, useState } from "react";
import clsx from "clsx";
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

type Props = {
  lang: Language;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  inputClass?: string;
  showHint?: boolean;
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
}: Props) {
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const [isOther, setIsOther] = useState(false);

  useEffect(() => {
    const next = categoryShelfPickFromValue(value, options);
    setPick(next.pick);
    setCustom(next.custom);
    setIsOther(next.isOther);
  }, [value, options]);

  const emit = (nextPick: string, nextCustom: string, nextOther: boolean) => {
    onChange(resolveCategoryShelfValue(nextPick, nextCustom, nextOther));
  };

  const showCustomInput = isOther || options.length === 0;

  return (
    <div className="space-y-3">
      {showHint && options.length > 0 ? (
        <p className="text-sm font-medium text-muted-foreground">{hint ?? t(lang, "categoryPickHint")}</p>
      ) : null}

      {options.length > 0 ? (
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
        </div>
      ) : null}

      {showCustomInput ? (
        <input
          value={custom}
          onChange={(e) => {
            const next = e.target.value;
            setCustom(next);
            emit(pick, next, true);
          }}
          placeholder={placeholder}
          autoFocus={isOther}
          autoComplete="off"
          className={inputClass}
        />
      ) : null}
    </div>
  );
}
