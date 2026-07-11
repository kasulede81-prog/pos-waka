import { Construction } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseEmptyState } from "./EnterpriseEmptyState";

type Props = {
  lang: Language;
  titleKey?: string;
  bodyKey?: string;
};

/** Clearly labelled future enterprise functionality — no fake workflows. */
export function EnterpriseComingSoonPanel({
  lang,
  titleKey = "notifyComingSoonTransfers",
  bodyKey = "enterpriseComingSoonBody",
}: Props) {
  return (
    <EnterpriseEmptyState
      icon={Construction}
      title={t(lang, titleKey)}
      description={t(lang, bodyKey)}
    />
  );
}
