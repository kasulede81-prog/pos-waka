import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";

type BaseProps = {
  label: string;
  complete?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
};

type InputProps = BaseProps &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: "input";
  };

type SelectProps = BaseProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    as: "select";
    children: ReactNode;
  };

export function BuilderField(props: InputProps | SelectProps) {
  const { label, complete, hint, error, className, ...rest } = props;
  const fieldClass = clsx(
    "mt-1.5 w-full min-h-[48px] rounded-2xl border px-4 py-3 pr-12 text-base outline-none transition-all",
    complete
      ? "border-emerald-300 bg-emerald-50/50 ring-emerald-200 focus:border-emerald-400 focus:ring-2"
      : "border-border bg-card ring-waka-200 focus:border-waka-400 focus:ring-2",
    className,
  );

  return (
    <label className="relative block text-sm font-bold text-foreground">
      {label}
      <div className="relative">
        {props.as === "select" ? (
          <select {...(rest as SelectHTMLAttributes<HTMLSelectElement>)} className={fieldClass}>
            {props.children}
          </select>
        ) : (
          <input {...(rest as InputHTMLAttributes<HTMLInputElement>)} className={fieldClass} />
        )}
        {complete ? (
          <span
            className="builder-field-check pointer-events-none absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
            aria-hidden
          >
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs font-medium text-muted-foreground">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-semibold text-red-600">{error}</p> : null}
    </label>
  );
}

export function BuilderPrimaryButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={clsx(
        "min-h-[52px] w-full touch-manipulation rounded-[28px] bg-gradient-to-r from-waka-500 to-waka-600 px-4 py-3.5 text-lg font-black text-white shadow-[0_12px_32px_-8px_rgba(234,88,12,0.55)] transition active:scale-[0.99] disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function BuilderCard({
  selected,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={clsx(
        "min-h-[80px] w-full rounded-[24px] border-2 px-4 py-3 text-left transition active:scale-[0.99]",
        selected
          ? "border-waka-500 bg-waka-50 shadow-md"
          : "border-border bg-card hover:border-border",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
