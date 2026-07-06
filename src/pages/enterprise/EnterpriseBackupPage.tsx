import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";

export function EnterpriseBackupPage({ lang }: { lang: Language }) {
  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_backup")} subtitle={t(lang, "enterpriseBackupSub")}>
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <ul className="space-y-2 text-sm font-semibold text-stone-700">
          <li>{t(lang, "enterpriseBackup_snapshot")}</li>
          <li>{t(lang, "enterpriseBackup_manual")}</li>
          <li>{t(lang, "enterpriseBackup_automatic")}</li>
          <li>{t(lang, "enterpriseBackup_restore")}</li>
          <li>{t(lang, "enterpriseBackup_branch")}</li>
          <li>{t(lang, "enterpriseBackup_org")}</li>
        </ul>
        <p className="mt-4 text-xs font-medium text-stone-500">{t(lang, "enterpriseBackupNote")}</p>
      </div>
    </EnterpriseShell>
  );
}
