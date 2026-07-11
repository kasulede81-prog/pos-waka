import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { themeUi } from "../../lib/themeTokens";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "type" | "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  row?: boolean;
};

export function WakaSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  row = true,
  className,
  disabled,
  id,
  ...props
}: Props) {
  const switchId = id ?? (typeof label === "string" ? `waka-switch-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);

  const track = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      id={switchId}
      onClick={() => onCheckedChange(!checked)}
      className={clsx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200",
        themeUi.focusRing,
        checked ? themeUi.switchTrackOn : themeUi.switchTrackOff,
        disabled && "cursor-not-allowed opacity-50",
        !row && className,
      )}
      {...props}
    >
      <span
        className={clsx(
          "inline-block h-5 w-5 transform rounded-full transition-transform duration-200",
          themeUi.switchThumb,
          checked ? "translate-x-[1.35rem]" : "translate-x-1",
        )}
        aria-hidden
      />
    </button>
  );

  if (!label && !description) return track;

  return (
    <label
      htmlFor={switchId}
      className={clsx(
        row && "flex min-h-[44px] cursor-pointer items-start justify-between gap-4 py-1",
        row && className,
      )}
    >
      <span className="min-w-0 flex-1">
        {label ? <span className="block text-sm font-bold text-foreground">{label}</span> : null}
        {description ? <span className="mt-0.5 block text-xs font-medium text-muted-foreground">{description}</span> : null}
      </span>
      {track}
    </label>
  );
}
