import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { EnterpriseComingSoonPanel } from "../../components/enterprise/EnterpriseComingSoonPanel";

export function EnterprisePurchasingPage({ lang }: { lang: Language }) {
  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_purchasing")} subtitle={t(lang, "enterprisePurchasingSub")}>
      <EnterpriseComingSoonPanel
        lang={lang}
        titleKey="enterpriseComingSoonPurchasing"
        bodyKey="enterpriseComingSoonPurchasingBody"
      />
      <p className="mt-4 text-sm font-medium text-muted-foreground">
        {t(lang, "enterprisePurchasingShopHint")}{" "}
        <Link to="/stock?tab=purchases" className="font-bold text-waka-700">
          {t(lang, "navStock")} → {t(lang, "ipTabPurchases")}
        </Link>
      </p>
    </EnterpriseShell>
  );
}
