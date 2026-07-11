import { forwardRef, type InputHTMLAttributes } from "react";
import { Capacitor } from "@capacitor/core";
import clsx from "clsx";

export type PinInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "pattern"> & {
  /** Mask digits on screen (default true). */
  masked?: boolean;
};

function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * @deprecated Authentication flows must use EnterprisePinPad. Non-auth numeric entry only.
 */
export const PinInput = forwardRef<HTMLInputElement, PinInputProps>(function PinInput(
  { className, masked = true, autoComplete = "off", ...rest },
  ref,
) {
  const android = isAndroid();
  const maskOnScreen = masked && !android;

  return (
    <input
      ref={ref}
      type={android ? "text" : "tel"}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete={autoComplete}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      enterKeyHint="done"
      data-lpignore="true"
      data-1p-ignore
      className={clsx(maskOnScreen && "[-webkit-text-security:disc]", className)}
      {...rest}
    />
  );
});
