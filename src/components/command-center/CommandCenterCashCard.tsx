import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerCashExtended } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { WakaButton } from "../ui/wakaPrimitives";
import { statusTokens } from "../../lib/statusTokens";
import { Banknote, Landmark, PiggyBank, Receipt, Scale, Wallet } from "lucide-react";

type Props = {
  lang: Language;
  cash: OwnerCashExtended;
};

export function CommandCenterCashCard({ lang, cash }: Props) {
  return (
    <EnterpriseCard
      title={t(lang, "cmdCenterCashTitle")}
      subtitle={t(lang, "ownerCashSub")}
      actions={
        cash.hasUnresolvedVariance ? (
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-black uppercase", statusTokens.danger.badge, statusTokens.danger.badgeRing)}>
            {t(lang, "ownerCashUnresolved")}
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <EnterpriseKpiCard icon={Wallet} label={t(lang, "ownerCashExpected")} value={formatShortUgx(cash.periodExpectedCashUgx)} />
        <EnterpriseKpiCard
          icon={Scale}
          label={t(lang, "ownerCashCounted")}
          value={cash.latestCountedCashUgx != null ? formatShortUgx(cash.latestCountedCashUgx) : "—"}
        />
        <EnterpriseKpiCard
          icon={Banknote}
          label={t(lang, "ownerCashDayVariance")}
          value={cash.latestDayVarianceUgx != null ? formatShortUgx(cash.latestDayVarianceUgx) : "—"}
          tone={cash.latestDayVarianceUgx != null && cash.latestDayVarianceUgx !== 0 ? "danger" : "default"}
        />
        <EnterpriseKpiCard icon={PiggyBank} label={t(lang, "ownerCashOwnerWithdrawal")} value={formatShortUgx(cash.ownerWithdrawalsUgx)} />
        <EnterpriseKpiCard icon={Landmark} label={t(lang, "ownerCashBankDeposit")} value={formatShortUgx(cash.bankDepositsUgx)} />
        <EnterpriseKpiCard icon={Receipt} label={t(lang, "ownerCashExpenses")} value={formatShortUgx(cash.cashExpensesUgx)} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link to="/office/cash-position">
          <WakaButton type="button" variant="primary" className="w-full">
            {t(lang, "ownerCashViewPosition")}
          </WakaButton>
        </Link>
        <Link to="/close-day">
          <WakaButton type="button" variant="secondary" className="w-full">
            {t(lang, "ownerCashViewClose")}
          </WakaButton>
        </Link>
      </div>
    </EnterpriseCard>
  );
}
