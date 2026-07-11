import { Link, useNavigate } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { EnterpriseEmptyState } from "../../components/enterprise/EnterpriseEmptyState";
import { Database } from "lucide-react";

export function EnterpriseBackupPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_backup")} subtitle={t(lang, "enterpriseBackupSub")}>
      <EnterpriseEmptyState
        icon={Database}
        title={t(lang, "enterpriseBackupStatusTitle")}
        description={t(lang, "enterpriseBackupStatusBody")}
        primaryAction={{
          label: t(lang, "enterpriseBackupGoShop"),
          onClick: () => navigate("/office/backup"),
        }}
        secondaryAction={{
          label: t(lang, "enterpriseNav_branches"),
          onClick: () => navigate("/enterprise/branches"),
        }}
      />
      <p className="mt-4 text-xs font-medium text-muted-foreground">{t(lang, "enterpriseBackupNote")}</p>
      <p className="mt-2 text-sm font-semibold text-muted-foreground">
        <Link to="/office/backup" className="font-bold text-waka-700">
          {t(lang, "enterpriseBackupGoShop")} →
        </Link>
      </p>
    </EnterpriseShell>
  );
}
