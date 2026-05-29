import { forwardRef, type InputHTMLAttributes } from "react";

export type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "pattern">;

/**
 * Whole-number UGX — numeric keypad on Android/iOS (type=text + inputMode beats type=tel in many WebViews).
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { autoComplete = "off", enterKeyHint = "done", className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete={autoComplete}
      enterKeyHint={enterKeyHint}
      className={`waka-money-input ${className}`.trim()}
      {...rest}
    />
  );
});
