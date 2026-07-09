import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { PosShelfArrangePanel } from "../components/pos/PosShelfArrangePanel";

export function SettingsShelvesPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);

  if (!actorHasPermission(actor, "settings.shop") || !actorHasPermission(actor, "shelves.customize")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <BackOfficePageLayout
      header={
        <SettingsPageHeader
          lang={lang}
          title={t(lang, "settingsHubShelves")}
          subtitle={t(lang, "settingsHubShelvesSub")}
          backTo="/settings"
        />
      }
      className="pb-8"
    >
      <PosShelfArrangePanel lang={lang} products={products} embedded />
    </BackOfficePageLayout>
  );
}
