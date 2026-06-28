import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import { useMarketingTheme } from "./MarketingThemeProvider";

const LABELS = {
  light: "Light mode",
  dark: "Dark mode",
  system: "System theme",
} as const;

export function MarketingThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, cycleTheme } = useMarketingTheme();
  const reduceMotion = useReducedMotion();

  const Icon = preference === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const label = `${LABELS[preference]} — click to change`;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
      className={clsx(
        "relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-mkt-border bg-mkt-bg-secondary text-mkt-text-secondary transition-[background-color,border-color,color,box-shadow] duration-500 hover:border-orange-300 hover:text-orange-600 dark:hover:border-orange-500/50 dark:hover:text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg",
        className,
      )}
    >
      <m.span
        key={`${preference}-${resolved}`}
        initial={reduceMotion ? false : { opacity: 0, rotate: -40, scale: 0.85 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center justify-center"
      >
        <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
      </m.span>
    </button>
  );
}
