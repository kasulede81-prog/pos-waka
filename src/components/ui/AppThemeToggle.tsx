import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useAppTheme } from "../../context/AppThemeProvider";

type Props = {
  lang: Language;
  className?: string;
  /** Compact icon-only button (header / auth). */
  variant?: "icon" | "inline";
  inverted?: boolean;
};

export function AppThemeToggle({ lang, className, variant = "icon", inverted = false }: Props) {
  const { preference, resolved, cycleTheme } = useAppTheme();

  const Icon = preference === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const label = t(lang, "themeToggleAria").replace("{{mode}}", t(lang, `themeMode_${preference}`));

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={label}
        title={label}
        className={clsx(
          "inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition-colors",
          inverted
            ? "border-waka-400/50 bg-waka-700/50 text-white hover:bg-waka-700"
            : "border-border bg-card text-foreground hover:bg-muted dark:bg-foreground dark:text-background dark:hover:bg-foreground",
          className,
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t(lang, `themeMode_${preference}`)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      className={clsx(
        "relative flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-colors",
        inverted
          ? "border-waka-400/50 bg-waka-700/50 text-white hover:bg-waka-700"
          : "border-border bg-card text-muted-foreground hover:bg-muted dark:bg-foreground dark:text-muted-foreground dark:hover:bg-foreground",
        className,
      )}
    >
      <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
    </button>
  );
}
