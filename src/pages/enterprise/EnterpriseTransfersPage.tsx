import { ArrowLeftRight } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { EnterpriseEmptyState } from "../../components/enterprise/EnterpriseEmptyState";

export function EnterpriseTransfersPage({ lang }: { lang: Language }) {
  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_transfers")} subtitle={t(lang, "enterpriseTransfersSub")}>
      <EnterpriseEmptyState
        icon={ArrowLeftRight}
        title={t(lang, "notifyComingSoonTransfers")}
        description={t(lang, "notifyComingSoonTransfersBody")}
      />
    </EnterpriseShell>
  );
}
