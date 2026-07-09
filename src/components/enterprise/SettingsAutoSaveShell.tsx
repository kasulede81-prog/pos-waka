import type { ReactNode } from "react";
import type { Language } from "../../types";
import { EnterprisePageContainer } from "../layout/EnterprisePageContainer";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";
import { PreferencesAutoSaveProvider } from "./preferencesAutoSaveContext";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
  className?: string;
};

/** Settings page shell with floating auto-save feedback. */
export function SettingsAutoSaveShell({
  lang,
  title,
  subtitle,
  backTo,
  backLabel,
  children,
  className,
}: Props) {
  return (
    <PreferencesAutoSaveProvider lang={lang}>
      <EnterprisePageContainer className={className ?? "space-y-5"}>
        <SettingsPageHeader lang={lang} title={title} subtitle={subtitle} backTo={backTo} backLabel={backLabel} />
        {children}
      </EnterprisePageContainer>
    </PreferencesAutoSaveProvider>
  );
}
