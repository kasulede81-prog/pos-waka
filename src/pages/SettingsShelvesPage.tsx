import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { PosShelfArrangePanel } from "../components/pos/PosShelfArrangePanel";

export function SettingsShelvesPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);

  if (!hasPermission(actor.role, "settings.shop") || !hasPermission(actor.role, "shelves.customize")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubShelves")}
        subtitle={t(lang, "settingsHubShelvesSub")}
      />
      <PosShelfArrangePanel lang={lang} products={products} embedded />
    </div>
  );
}
