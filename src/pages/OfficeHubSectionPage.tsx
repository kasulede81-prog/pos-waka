import { Navigate, useParams } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { OfficeHubSectionBody } from "../components/office/OfficeHubSectionBody";
import { isOfficeHubSectionId, OFFICE_HUB_SECTIONS } from "../lib/officeHubSections";
import { useOfficeHubAccess } from "../hooks/useOfficeHubAccess";

export function OfficeHubSectionPage({ lang }: { lang: Language }) {
  const { sectionId } = useParams<{ sectionId: string }>();
  const { sectionVisible } = useOfficeHubAccess();

  if (!isOfficeHubSectionId(sectionId)) {
    return <Navigate to="/office" replace />;
  }

  if (!sectionVisible[sectionId]) {
    return <Navigate to="/office" replace />;
  }

  const def = OFFICE_HUB_SECTIONS.find((s) => s.id === sectionId)!;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, def.titleKey)}
        subtitle={t(lang, def.subKey)}
        backFallback="/office"
        backLabel={t(lang, "officeHubTitle")}
      />
      <OfficeHubSectionBody lang={lang} section={sectionId} />
    </div>
  );
}
