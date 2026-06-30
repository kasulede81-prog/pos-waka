import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import { useMarketingTheme } from "./MarketingThemeProvider";

const LABELS = {
  light: "Light mode",
  dark: "Dark mode",
  system: "System theme",
} as const;

const MODE_SHORT = {
  light: "Light",
  dark: "Dark",
  system: "Auto",
} as const;

type Props = {
  className?: string;
  /** Icon-only for desktop header; labeled pill for mobile discoverability. */
  variant?: "icon" | "labeled";
};

export function MarketingThemeToggle({ className, variant = "icon" }: Props) {
  const { preference, resolved, cycleTheme } = useMarketingTheme();
  const reduceMotion = useReducedMotion();

  const Icon = preference === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const label = `${LABELS[preference]} — tap to change theme`;

  const iconMotion = (
    <m.span
      key={`${preference}-${resolved}`}
      initial={reduceMotion ? false : { opacity: 0, rotate: -40, scale: 0.85 }}
      animate={{ opacity: 1, rotate: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center justify-center"
    >
      <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
    </m.span>
  );

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={label}
        title={label}
        className={clsx(
          "inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border-2 border-mkt-border bg-mkt-card px-2.5 py-1.5 text-xs font-black text-mkt-text shadow-sm transition-[background-color,border-color,color,box-shadow] duration-500 hover:border-waka- hover:text-waka- dark:hover:border-waka-/50 dark:hover:text-waka- focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka- focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg",
          className,
        )}
      >
        {iconMotion}
        <span className="whitespace-nowrap">
          Theme · {MODE_SHORT[preference]}
        </span>
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
        "relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-mkt-border bg-mkt-card text-mkt-text shadow-sm transition-[background-color,border-color,color,box-shadow] duration-500 hover:border-waka- hover:text-waka- dark:hover:border-waka-/50 dark:hover:text-waka- focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka- focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg",
        className,
      )}
    >
      {iconMotion}
    </button>
  );
}
