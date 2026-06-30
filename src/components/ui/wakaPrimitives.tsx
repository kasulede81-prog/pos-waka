import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes } from "react";
import { wakaUi } from "../../lib/brandTokens";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: wakaUi.btnPrimary,
  secondary: wakaUi.btnSecondary,
  ghost: wakaUi.btnGhost,
  destructive:
    "inline-flex min-h-[44px] items-center justify-center rounded-xl bg-destructive px-4 py-2.5 text-sm font-black text-destructive-foreground shadow-sm transition-waka active:opacity-90 disabled:opacity-50",
};

export const WakaButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function WakaButton({ className, variant = "primary", type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={clsx(BTN_VARIANT[variant], className)} {...props} />;
});

export function WakaCard({
  className,
  muted,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { muted?: boolean }) {
  return (
    <div className={clsx(muted ? wakaUi.surfaceMuted : wakaUi.surface, className)} {...props}>
      {children}
    </div>
  );
}

export const WakaInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function WakaInput(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(wakaUi.input, className)} {...props} />;
});

export function WakaPage({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("min-h-0 space-y-4", wakaUi.pageBg, className)} {...props}>
      {children}
    </div>
  );
}
