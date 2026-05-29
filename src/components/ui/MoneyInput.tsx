import { forwardRef, type InputHTMLAttributes } from "react";

export type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "pattern">;

/** Whole-number money amount — numeric keypad on phones/tablets. */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { autoComplete = "off", enterKeyHint = "done", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="tel"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete={autoComplete}
      enterKeyHint={enterKeyHint}
      {...rest}
    />
  );
});
