import { Link } from "react-router-dom";
import { Shield, BarChart3, Truck, Banknote, CalendarCheck, Receipt } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  showRecordExpense: boolean;
};

export function OwnerQuickActionsRow({ lang, showRecordExpense }: Props) {
  const actions = [
    { to: "/office/audit-center", label: t(lang, "officeCardAuditCenter"), Icon: Shield },
    { to: "/reports", label: t(lang, "reports"), Icon: BarChart3 },
    { to: "/office/purchases", label: t(lang, "officeCardPurchases"), Icon: Truck },
    { to: "/office/cash-position", label: t(lang, "officeCardCashPosition"), Icon: Banknote },
    { to: "/close-day", label: t(lang, "closeDay"), Icon: CalendarCheck },
    ...(showRecordExpense
      ? [{ to: "/cash-expenses", label: t(lang, "officeCardCashExpenses"), Icon: Receipt }]
      : []),
  ];

  return (
    <HistoryListCard>
      <div className="border-b border-stone-100 px-4 py-3">
        <h2 className="text-base font-black text-slate-950">{t(lang, "ownerSectionQuickActions")}</h2>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto p-4 pb-1">
        {actions.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            className="inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-black text-slate-800 transition-colors hover:border-waka-300 hover:bg-waka-50 active:scale-[0.98]"
          >
            <Icon className="h-4 w-4 shrink-0 text-waka-700" aria-hidden />
            {label}
          </Link>
        ))}
      </div>
    </HistoryListCard>
  );
}
