import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterprisePageHeader } from "../enterprise/EnterprisePageHeader";

type Props = {
  lang: Language;
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
};

export function SettingsPageHeader({ lang, title, subtitle, backTo, backLabel }: Props) {
  return (
    <EnterprisePageHeader
      lang={lang}
      title={title}
      subtitle={subtitle}
      backFallback={backTo}
      backLabel={backLabel ?? t(lang, "settingsHubBack")}
      compact
    />
  );
}
