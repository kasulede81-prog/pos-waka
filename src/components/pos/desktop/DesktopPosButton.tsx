import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type DesktopPosButtonVariant = "default" | "primary" | "success" | "warning" | "danger" | "payment";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: DesktopPosButtonVariant;
  selected?: boolean;
  loading?: boolean;
  size?: "sm" | "md" | "lg" | "touch";
  children: ReactNode;
};

const variantClass: Record<DesktopPosButtonVariant, string> = {
  default:
    "border-border bg-card text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-muted active:bg-muted active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.12)]",
  primary:
    "border-waka-600 bg-waka-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] hover:bg-waka-700 active:bg-waka-800 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
  success:
    "border-teal-700 bg-teal-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-teal-800 active:bg-teal-900 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
  warning:
    "border-warning/40 bg-warning-muted text-warning-foreground hover:bg-warning-muted active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.08)]",
  danger:
    "border-danger/40 bg-danger-muted text-danger hover:bg-danger-muted active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]",
  payment:
    "border-border bg-card text-foreground font-black uppercase tracking-wide hover:border-waka-400 hover:bg-waka-50 active:bg-waka-100 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]",
};

const sizeClass: Record<NonNullable<Props["size"]>, string> = {
  sm: "min-h-[36px] px-2.5 py-1 text-xs",
  md: "min-h-[44px] px-3 py-2 text-sm",
  lg: "min-h-[52px] px-4 py-2.5 text-base",
  touch: "min-h-[56px] px-4 py-3 text-base",
};

/** Tactile POS button — large touch targets with pressed / selected states. */
export function DesktopPosButton({
  variant = "default",
  selected = false,
  loading = false,
  size = "md",
  className,
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        "desktop-pos-btn inline-flex items-center justify-center gap-1.5 rounded-lg border font-bold transition-[transform,box-shadow,background-color,border-color] duration-75",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-waka-500",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "motion-reduce:active:scale-100 active:scale-[0.98]",
        variantClass[variant],
        sizeClass[size],
        selected && variant === "payment" && "border-waka-600 bg-waka-600 text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]",
        selected && variant !== "payment" && "ring-2 ring-waka-500 ring-offset-1",
        className,
      )}
      {...rest}
    >
      {loading ? <span className="opacity-80">…</span> : children}
    </button>
  );
}
