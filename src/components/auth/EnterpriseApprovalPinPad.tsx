import type { Language, ShopPreferences } from "../../types";
import { EnterprisePinPad } from "./EnterprisePinPad";
import { verifyFloatVerifyOverride } from "../../lib/enterpriseSecurity/EnterpriseSecurityService";
import { useSessionActor } from "../../context/SessionActorContext";

type Props = {
  lang: Language;
  preferences: ShopPreferences;
  onApproved: (pin: string) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  resetSignal?: string | number;
  className?: string;
  persistOnSuccess?: boolean;
};

/** Manager / owner approval PIN — verifies via existing EnterpriseSecurityService rules. */
export function EnterpriseApprovalPinPad({
  lang,
  preferences,
  onApproved,
  disabled,
  resetSignal,
  className,
  persistOnSuccess,
}: Props) {
  const actor = useSessionActor();

  return (
    <EnterprisePinPad
      lang={lang}
      disabled={disabled}
      resetSignal={resetSignal}
      className={className}
      persistOnSuccess={persistOnSuccess}
      size="mobile"
      onComplete={async (pin) => {
        const verified = await verifyFloatVerifyOverride(
          pin,
          preferences,
          actor.role ?? "cashier",
          actor.userId ?? "unknown",
          actor.displayName?.trim() || actor.role || "User",
        );
        if (!verified.ok) {
          return false;
        }
        const result = await onApproved(pin);
        if (result === false) return false;
        return true;
      }}
    />
  );
}
