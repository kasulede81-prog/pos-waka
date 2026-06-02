import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { SystemHealthCard } from "../components/settings/SystemHealthCard";
import { AuditHealthCard } from "../components/settings/AuditHealthCard";
import { DebtIntegrityCard } from "../components/settings/DebtIntegrityCard";
import { ProductionReadinessCard } from "../components/settings/ProductionReadinessCard";
import { SyncHealthCard } from "../components/SyncHealthCard";

export function SettingsSystemHealthPage({ lang }: { lang: Language }) {
  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "systemHealthPageTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "systemHealthPageSub")}</p>
      </div>
      <ProductionReadinessCard lang={lang} />
      <SystemHealthCard lang={lang} />
      <DebtIntegrityCard lang={lang} />
      <AuditHealthCard lang={lang} />
      <SyncHealthCard lang={lang} variant="full" />
    </div>
  );
}
