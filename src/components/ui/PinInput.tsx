import { forwardRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";

export type PinInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "pattern"> & {
  /** Mask digits on screen (default true). */
  masked?: boolean;
};

/** PIN / numeric secret — uses `type="tel"` so mobile shows the number pad (not QWERTY). */
export const PinInput = forwardRef<HTMLInputElement, PinInputProps>(function PinInput(
  { className, masked = true, autoComplete = "one-time-code", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="tel"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete={autoComplete}
      className={clsx(masked && "[-webkit-text-security:disc]", className)}
      {...rest}
    />
  );
});
