import clsx from "clsx";
import type { InputHTMLAttributes, ReactNode } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** Full-row tap target (default true). */
  row?: boolean;
};

/**
 * Styled checkbox for multi-select lists and forms — same enterprise sizing as WakaSwitch.
 * Use WakaSwitch for boolean settings; WakaCheckbox for selection lists.
 */
export function WakaCheckbox({
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
  const checkboxId =
    id ?? (typeof label === "string" ? `waka-checkbox-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);

  const box = (
    <input
      type="checkbox"
      id={checkboxId}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className={clsx(
        "h-5 w-5 shrink-0 rounded border-2 border-stone-300 accent-waka-600",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-400 focus-visible:ring-offset-2",
        disabled && "cursor-not-allowed opacity-50",
        !row && className,
      )}
      {...props}
    />
  );

  if (!label && !description) return box;

  return (
    <label
      htmlFor={checkboxId}
      className={clsx(
        row && "flex min-h-[44px] cursor-pointer items-start gap-3 py-1",
        row && className,
      )}
    >
      <span className="mt-0.5">{box}</span>
      <span className="min-w-0 flex-1">
        {label ? <span className="block text-sm font-bold text-stone-900">{label}</span> : null}
        {description ? <span className="mt-0.5 block text-xs font-medium text-stone-500">{description}</span> : null}
      </span>
    </label>
  );
}
