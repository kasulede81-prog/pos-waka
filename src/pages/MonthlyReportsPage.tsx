import { actorHasPermission } from "../lib/actorAuthorization";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";

import { PageHeader } from "../components/layout/PageHeader";
import { MonthlyReportsPanel } from "../components/reports/MonthlyReportsPanel";

type Props = { lang: Language };

export function MonthlyReportsPage({ lang }: Props) {
  const actor = useSessionActor();
  const canView = actorHasPermission(actor, "reports.view");

  if (!canView) {
    return <Navigate to="/office" replace />;
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        lang={lang}
        title={t(lang, "monthlyReportTitle")}
        subtitle={t(lang, "monthlyReportSub")}
        backFallback="/reports?tab=monthly"
        backLabel={t(lang, "officeBackToHub")}
      />
      <MonthlyReportsPanel lang={lang} />
    </div>
  );
}
