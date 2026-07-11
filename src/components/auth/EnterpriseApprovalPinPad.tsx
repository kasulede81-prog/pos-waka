import type { Language, ShopPreferences } from "../../types";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { verifyManagerApprovalPinSync } from "../../lib/enterpriseSecurity/EnterpriseSecurityService";

type Props = {
  lang: Language;
  preferences: ShopPreferences;
  onApproved: (pin: string) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  resetSignal?: string | number;
  className?: string;
};

/** Manager / owner approval PIN — verifies via existing EnterpriseSecurityService rules. */
export function EnterpriseApprovalPinPad({
  lang,
  preferences,
  onApproved,
  disabled,
  resetSignal,
  className,
}: Props) {
  return (
    <EnterprisePinPad
      lang={lang}
      disabled={disabled}
      resetSignal={resetSignal}
      className={className}
      onComplete={async (pin) => {
        if (!verifyManagerApprovalPinSync(pin, preferences)) {
          return false;
        }
        const result = await onApproved(pin);
        if (result === false) return false;
        return true;
      }}
    />
  );
}
