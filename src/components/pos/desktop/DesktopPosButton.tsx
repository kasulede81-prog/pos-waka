import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

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
    "border-border bg-card text-foreground shadow-sm hover:bg-muted active:bg-muted",
  primary:
    "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80",
  success:
    "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80",
  warning:
    "border-warning/40 bg-warning-muted text-warning-foreground hover:bg-warning-muted",
  danger:
    "border-danger/40 bg-danger-muted text-danger hover:bg-danger-muted",
  payment:
    "border-border bg-card text-foreground font-black uppercase tracking-wide hover:border-primary/60 hover:bg-accent active:bg-muted",
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
         selected && variant === "payment" && "border-primary bg-primary text-primary-foreground shadow-sm",
        selected && variant !== "payment" && "ring-2 ring-waka-500 ring-offset-1",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : children}
    </button>
  );
}
