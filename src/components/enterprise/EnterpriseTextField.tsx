import clsx from "clsx";
import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";
import { wakaUi } from "../../lib/brandTokens";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** POS numeric entry — 52px height, larger type */
  pos?: boolean;
};

/**
 * Enterprise form text field — labels, validation, spacing (Phase 22.2).
 */
export const EnterpriseTextField = forwardRef<HTMLInputElement, Props>(function EnterpriseTextField(
  { label, hint, error, pos, className, id, ...props },
  ref,
) {
  const fieldId = id ?? (typeof label === "string" ? label.replace(/\s+/g, "-").toLowerCase() : undefined);

  return (
    <label className="block">
      {label ? (
        <span className={clsx(enterpriseTypeClass("body", "mb-1.5 block !text-sm !font-bold text-foreground"))}>
          {label}
        </span>
      ) : null}
      <input
        ref={ref}
        id={fieldId}
        className={clsx(
          pos
            ? "min-h-[52px] w-full rounded-2xl border-2 border-input bg-card px-4 text-2xl font-black tabular-nums text-foreground shadow-sm outline-none transition-waka placeholder:text-muted-foreground focus:border-waka-400 focus:ring-2 focus:ring-waka-200/60 disabled:cursor-not-allowed disabled:opacity-50"
            : wakaUi.input,
          error && "border-danger focus:border-danger focus:ring-danger/30",
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      />
      {hint && !error ? (
        <p id={`${fieldId}-hint`} className={clsx(enterpriseTypeClass("caption", "mt-1.5 normal-case"))}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="mt-1.5 text-sm font-bold text-danger-foreground"
        >
          {error}
        </p>
      ) : null}
    </label>
  );
});
