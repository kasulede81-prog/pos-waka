import clsx from "clsx";
import { Delete, Lock } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  /** Desktop 40px, tablet 48px, mobile 44px minimum targets. */
  size?: "desktop" | "tablet" | "mobile";
};

export function EnterprisePinKeypad({
  lang,
  value,
  onChange,
  onSubmit,
  maxLength = 4,
  disabled = false,
  className,
  size = "tablet",
}: Props) {
  const digit = (d: string) => {
    if (disabled || value.length >= maxLength) return;
    onChange(value + d);
  };

  const backspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  const keyClass = clsx(
    "rounded-2xl border-2 font-black transition active:scale-[0.97] disabled:opacity-40 motion-reduce:active:scale-100",
    size === "desktop" && "min-h-[40px] text-lg",
    size === "tablet" && "min-h-[48px] text-xl",
    size === "mobile" && "min-h-[44px] text-xl",
    "border-stone-200 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50",
  );

  return (
    <div className={clsx("space-y-4", className)}>
      <div className="flex items-center justify-center gap-3" aria-hidden>
        {Array.from({ length: maxLength }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              "h-3 w-3 rounded-full border-2 transition",
              i < value.length
                ? "border-waka-600 bg-waka-600 dark:border-waka-400 dark:bg-waka-400"
                : "border-stone-300 bg-transparent dark:border-stone-600",
            )}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" disabled={disabled} className={keyClass} onClick={() => digit(d)}>
            {d}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className={clsx(keyClass, "border-transparent bg-transparent text-stone-500 dark:text-stone-400")}
          onClick={backspace}
          aria-label={t(lang, "pinKeypadBackspace")}
        >
          <Delete className="mx-auto h-5 w-5" />
        </button>
        <button type="button" disabled={disabled} className={keyClass} onClick={() => digit("0")}>
          0
        </button>
        <button
          type="button"
          disabled={disabled || value.length < maxLength}
          className={clsx(keyClass, "border-waka-600 bg-waka-600 text-white dark:border-waka-500 dark:bg-waka-500")}
          onClick={() => onSubmit?.()}
          aria-label={t(lang, "unlockSubmit")}
        >
          <Lock className="mx-auto h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
