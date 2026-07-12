import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { wakaUi } from "../../lib/brandTokens";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { themeUi } from "../../lib/themeTokens";

export type WakaButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "icon";
export type WakaButtonSize = "standard" | "pos";

const HEIGHT: Record<WakaButtonSize, string> = {
  standard: "min-h-[44px]",
  pos: "min-h-[52px]",
};

const BTN_VARIANT: Record<Exclude<WakaButtonVariant, "icon">, string> = {
  primary: "bg-primary text-primary-foreground shadow-waka-sm hover:bg-primary-hover active:bg-waka-700",
  secondary: "border border-border bg-card text-foreground shadow-sm hover:bg-muted active:bg-muted/80",
  danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:opacity-90",
  ghost: "text-waka-700 hover:bg-muted active:bg-muted dark:text-waka-400",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50";

export const WakaButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: WakaButtonVariant;
    size?: WakaButtonSize;
    loading?: boolean;
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
  }
>(function WakaButton(
  {
    className,
    variant = "primary",
    size = "standard",
    type = "button",
    loading,
    disabled,
    iconLeft,
    iconRight,
    children,
    ...props
  },
  ref,
) {
  const isIconOnly = variant === "icon";
  const resolvedVariant = variant === "icon" ? "ghost" : variant;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        BASE,
        HEIGHT[size],
        enterpriseMotion.standard,
        enterpriseMotion.press,
        themeUi.focusRing,
        isIconOnly
          ? "min-h-[44px] min-w-[44px] rounded-xl p-0 px-0"
          : size === "pos"
            ? "rounded-2xl text-base"
            : null,
        BTN_VARIANT[resolvedVariant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className={enterpriseIconClass("sm")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
      ) : (
        iconLeft
      )}
      {children}
      {!loading ? iconRight : null}
    </button>
  );
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
  return <input ref={ref} className={clsx(wakaUi.input, themeUi.focusRing, className)} {...props} />;
});

export function WakaPage({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("min-h-0 space-y-4", wakaUi.pageBg, className)} {...props}>
      {children}
    </div>
  );
}

export { WakaSwitch } from "../enterprise/WakaSwitch";
export { WakaCheckbox } from "../enterprise/WakaCheckbox";
export { EnterpriseEmptyState } from "../enterprise/EnterpriseEmptyState";
export { EnterpriseSkeleton, EnterpriseSkeletonList } from "../enterprise/EnterpriseSkeleton";
export { EnterpriseSaveIndicator } from "../enterprise/EnterpriseSaveIndicator";
export { EnterpriseScrollControls } from "../enterprise/EnterpriseScrollControls";
export { EnterpriseListFooter } from "../enterprise/EnterpriseListFooter";
export { EnterpriseListToolbar } from "../enterprise/EnterpriseListToolbar";
export { SettingsAutoSaveShell } from "../enterprise/SettingsAutoSaveShell";
export { usePreferencesPatch } from "../enterprise/preferencesAutoSaveContext";
export { EnterpriseNavBack } from "../enterprise/EnterpriseNavBack";
export { EnterprisePageHeader } from "../enterprise/EnterprisePageHeader";
export { EnterpriseTextField } from "../enterprise/EnterpriseTextField";
export { EnterpriseCard } from "../enterprise/EnterpriseCard";
