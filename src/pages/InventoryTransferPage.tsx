import { ArrowLeftRight } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { PageHeader } from "../components/layout/PageHeader";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { PageBackBar } from "../components/layout/PageBackBar";

type Props = { lang: Language };

/** Stock transfers — UI placeholder until persistence is wired (Phase 17.2+). */
export function InventoryTransferPage({ lang }: Props) {
  return (
    <EnterprisePageContainer>
      <PageBackBar lang={lang} fallbackTo="/stock" label={t(lang, "navStock")} />
      <PageHeader lang={lang} title={t(lang, "xferPageTitle")} subtitle={t(lang, "xferPageSub")} />
      <EnterpriseEmptyState
        icon={ArrowLeftRight}
        title={t(lang, "notifyComingSoonTransfers")}
        description={t(lang, "notifyComingSoonTransfersBody")}
        className="mt-4"
      />
    </EnterprisePageContainer>
  );
}
