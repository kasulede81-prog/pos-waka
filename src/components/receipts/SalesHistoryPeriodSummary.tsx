import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { Caption } from "../enterprise/EnterpriseTypography";
import { themeUi } from "../../lib/themeTokens";

type Props = {
  lang: Language;
  salesLabel: string;
  salesUgx: number;
  itemsSold: number;
  profitUgx: number | null;
  showProfit: boolean;
  /** Desktop: Sales + Items + optional Profit. Mobile/tablet: one period total. */
  compact: boolean;
};

export function SalesHistoryPeriodSummary({
  lang,
  salesLabel,
  salesUgx,
  itemsSold,
  profitUgx,
  showProfit,
  compact,
}: Props) {
  if (compact) {
    return (
      <div className={clsx(themeUi.surface, "sales-history-summary px-4 py-3")}>
        <Caption className="normal-case tracking-wide">{salesLabel}</Caption>
        <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
          UGX {salesUgx.toLocaleString()}
        </p>
      </div>
    );
  }

  return (
    <dl className={clsx(themeUi.surface, "sales-history-summary grid gap-4 px-5 py-4", showProfit ? "grid-cols-3" : "grid-cols-2")}>
      <div className="min-w-0">
        <dt>
          <Caption>{salesLabel}</Caption>
        </dt>
        <dd className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-waka-800 sm:text-3xl">
          UGX {salesUgx.toLocaleString()}
        </dd>
      </div>
      <div className="min-w-0">
        <dt>
          <Caption>{t(lang, "salesHistoryItemsSold")}</Caption>
        </dt>
        <dd className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
          {itemsSold}
        </dd>
      </div>
      {showProfit ? (
        <div className="min-w-0">
          <dt>
            <Caption>{t(lang, "salesHistoryProfits")}</Caption>
          </dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-teal-800 sm:text-3xl">
            UGX {(profitUgx ?? 0).toLocaleString()}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
