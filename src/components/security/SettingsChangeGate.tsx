import type { Language } from "../../types";
import { SensitiveActionGate } from "./SensitiveActionGate";

type Props = {
  lang: Language;
  children: React.ReactNode;
};

/** Blocks settings mutations until biometric / Owner PIN when enabled. */
export function SettingsChangeGate({ lang, children }: Props) {
  return (
    <SensitiveActionGate lang={lang} kind="change_settings" deniedTo="/settings">
      {children}
    </SensitiveActionGate>
  );
}
