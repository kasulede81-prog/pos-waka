import clsx from "clsx";

export const WIZARD_INPUT_BASE =
  "min-h-[58px] w-full rounded-2xl border border-input bg-card px-4 text-foreground shadow-sm outline-none transition-[border-color,box-shadow,transform] duration-200 placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-ring/25 motion-reduce:transition-none";

export const WIZARD_INPUT_TEXT = clsx(WIZARD_INPUT_BASE, "text-xl font-bold tracking-tight");
export const WIZARD_INPUT_NUMERIC = clsx(WIZARD_INPUT_BASE, "text-3xl font-black tabular-nums tracking-tight");

export const WIZARD_BTN_FOOTER_BASE =
  "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl text-base font-black transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 motion-reduce:active:scale-100 motion-reduce:transition-none";

export function wizardChoiceButtonClass(selected: boolean): string {
  return clsx(
    "min-h-[56px] rounded-2xl border px-3 text-base font-black transition-all duration-200",
    "active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    selected
      ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/15"
      : "border-border bg-card text-foreground shadow-sm hover:border-primary/30 hover:bg-muted/30",
  );
}
