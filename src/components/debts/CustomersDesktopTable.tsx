import { useMemo } from "react";
import clsx from "clsx";
import type { Customer, Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CreditActivityIndex } from "../../lib/customerDebtActivity";
import { deriveCustomerDebtMeta, formatActivityWhen, formatShortUgx } from "../../lib/debtsPageView";
import { statusTokens } from "../../lib/statusTokens";
import {
  EnterpriseDataTable,
  EnterpriseDesktopBulkBar,
  useEnterpriseTableSelection,
  type EnterpriseDataColumn,
} from "../enterprise/data-table";
import { themeUi } from "../../lib/themeTokens";

type Props = {
  lang: Language;
  customers: Customer[];
  creditIndex: CreditActivityIndex;
  canDebt: boolean;
  sortBy: "balance_desc" | "balance_asc" | "name_az";
  onSortChange: (sort: "balance_desc" | "balance_asc" | "name_az") => void;
  onOpenDetail: (customer: Customer) => void;
  onReceive: (customer: Customer) => void;
  onExportSelected?: (customers: Customer[]) => void;
};

export function CustomersDesktopTable({
  lang,
  customers,
  creditIndex,
  canDebt,
  sortBy,
  onSortChange,
  onOpenDetail,
  onReceive,
  onExportSelected,
}: Props) {
  const selection = useEnterpriseTableSelection({ startEnabled: true });
  const localeLang = lang === "sw" ? "sw" : "en";

  const columns: EnterpriseDataColumn<Customer>[] = useMemo(
    () => [
      {
        id: "name_az",
        header: t(lang, "customers"),
        width: "minmax(160px,2fr)",
        sortable: true,
        cell: (c) => c.name,
        className: "text-foreground",
      },
      {
        id: "phone",
        header: "Phone",
        width: "minmax(110px,1fr)",
        hideBelow: "lg",
        cell: (c) => c.phone?.trim() || t(lang, "debtNoPhone"),
      },
      {
        id: "balance_desc",
        header: t(lang, "debtBalanceShort"),
        width: "minmax(100px,1fr)",
        sortable: true,
        align: "right",
        cell: (c) => (
          <span className={clsx("font-bold tabular-nums", c.debtBalanceUgx > 0 ? "text-danger" : "text-foreground")}>
            {formatShortUgx(c.debtBalanceUgx)}
          </span>
        ),
      },
      {
        id: "orders",
        header: "Orders",
        width: "minmax(64px,0.6fr)",
        hideBelow: "xl",
        align: "right",
        cell: (c) => String(creditIndex.salesByCustomer.get(c.id)?.length ?? 0),
      },
      {
        id: "activity",
        header: t(lang, "debtsLastSale"),
        width: "minmax(120px,1fr)",
        hideBelow: "lg",
        cell: (c) => {
          const meta = deriveCustomerDebtMeta(c, creditIndex);
          const last = meta.lastPayment ?? meta.lastSale;
          return last ? formatActivityWhen(last.at, localeLang) : "—";
        },
      },
      {
        id: "status",
        header: t(lang, "inventoryTableStatus"),
        width: "minmax(96px,0.9fr)",
        cell: (c) => {
          const meta = deriveCustomerDebtMeta(c, creditIndex);
          if (!c.debtBalanceUgx) return <span className={statusTokens.success.badge}>{t(lang, "debtsStatusCleared")}</span>;
          if (meta.isOverdue) return <span className={statusTokens.danger.badge}>{t(lang, "debtsStatusOverdue")}</span>;
          if (meta.isDueSoon) return <span className={statusTokens.warning.badge}>{t(lang, "debtsStatusDueSoon")}</span>;
          return <span className={statusTokens.pending.badge}>{t(lang, "debtBalanceShort")}</span>;
        },
      },
    ],
    [lang, creditIndex, localeLang],
  );

  const selectedCustomers = useMemo(
    () => customers.filter((c) => selection.isSelected(c.id)),
    [customers, selection],
  );

  return (
    <div className="space-y-2">
      <EnterpriseDesktopBulkBar
        lang={lang}
        count={selection.count}
        onClear={selection.clear}
        onSelectVisible={() => selection.selectIds(customers.map((c) => c.id))}
      >
        {onExportSelected ? (
          <button
            type="button"
            disabled={selectedCustomers.length === 0}
            onClick={() => onExportSelected(selectedCustomers)}
            className={clsx(themeUi.btnSecondary, "min-h-[36px] px-3 py-1.5 text-xs")}
          >
            {t(lang, "salesHistoryExport")}
          </button>
        ) : null}
        {canDebt && selectedCustomers.length === 1 && selectedCustomers[0]!.debtBalanceUgx > 0 ? (
          <button
            type="button"
            onClick={() => onReceive(selectedCustomers[0]!)}
            className={clsx(themeUi.btnPrimary, "min-h-[36px] px-3 py-1.5 text-xs")}
          >
            {t(lang, "repayDebt")}
          </button>
        ) : null}
      </EnterpriseDesktopBulkBar>

      <EnterpriseDataTable
        rows={customers}
        columns={columns}
        rowKey={(c) => c.id}
        sortKey={sortBy === "balance_asc" ? "balance_desc" : sortBy}
        onSort={(colId) => {
          if (colId === "name_az") onSortChange("name_az");
          else if (colId === "balance_desc") {
            onSortChange(sortBy === "balance_desc" ? "balance_asc" : "balance_desc");
          }
        }}
        selection={selection}
        onRowActivate={onOpenDetail}
        minWidthPx={900}
        ariaLabel={t(lang, "customers")}
        rowActions={(c) =>
          canDebt && c.debtBalanceUgx > 0 ? (
            <button
              type="button"
              onClick={() => onReceive(c)}
              className="rounded-lg px-2 py-1 text-[11px] font-bold text-waka-700 hover:bg-muted"
            >
              {t(lang, "repayDebt")}
            </button>
          ) : null
        }
      />
    </div>
  );
}
