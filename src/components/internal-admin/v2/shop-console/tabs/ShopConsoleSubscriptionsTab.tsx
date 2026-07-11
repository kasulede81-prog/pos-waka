import { lazy, Suspense, useEffect, useMemo } from "react";
import clsx from "clsx";
import { AdminCollapsible } from "../../../adminUi";
import { RescueSection } from "../../../rescue/RescuePrimitives";
import { adminKpiGridClass, KPI_VALUE_CLASS } from "../../../../../lib/desktopLayout";
import {
  buildRescueFinancialSnapshot,
  computeCloudBackupFinancial,
} from "../../../../../lib/rescueConsoleIntel";
import { t } from "../../../../../lib/i18n";
import type { ShopConsoleState } from "../useShopConsoleState";

const EnterpriseSubscriptionCard = lazy(() =>
  import("../../EnterpriseSubscriptionCard").then((m) => ({ default: m.EnterpriseSubscriptionCard })),
);

type Props = {
  ctx: ShopConsoleState;
};

function fmtUgx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

export function ShopConsoleSubscriptionsTab({ ctx }: Props) {
  const { lang, detail, canSubs, previewMode, rescue, loadRescueData } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  const financial = useMemo(() => {
    if (!detail) return null;
    const backupFin = computeCloudBackupFinancial(rescue.cloudSnapshot);
    return buildRescueFinancialSnapshot(detail, rescue.diagnostics, backupFin);
  }, [detail, rescue.cloudSnapshot, rescue.diagnostics]);

  if (!detail) return null;

  return (
    <div className="space-y-3">
      <Suspense
        fallback={
          <p className="rounded-2xl border border-border bg-card px-4 py-8 text-center text-sm font-semibold text-muted-foreground">
            Loading subscription…
          </p>
        }
      >
        <EnterpriseSubscriptionCard
          lang={lang}
          detail={detail}
          canManage={canSubs}
          busy={ctx.busy}
          previewMode={previewMode}
          onActionComplete={() => void ctx.loadShop()}
        />
      </Suspense>

      {detail.subscriptionPaymentsRecent.length > 0 ? (
        <AdminCollapsible
          title={t(lang, "internalShopProfilePaymentsTitle")}
          summary={`${detail.subscriptionPaymentsRecent.length} recent`}
        >
          <ul className="space-y-2 text-sm">
            {detail.subscriptionPaymentsRecent.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 rounded-xl bg-muted px-3 py-2 ring-1 ring-border">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(p.created_at).toLocaleString("en-GB")}
                </span>
                <span className="text-xs font-black text-foreground">
                  UGX {p.amount_ugx.toLocaleString("en-UG")} · {p.status}
                </span>
              </li>
            ))}
          </ul>
        </AdminCollapsible>
      ) : null}

      {financial ? (
        <RescueSection id="financial" title="Financial Snapshot" summary={`Source: ${financial.source.replace("_", " ")} · read-only`}>
          <div className={clsx(adminKpiGridClass(), "mt-1")}>
            {(
              [
                ["Revenue", financial.revenueUgx],
                ["Expenses", financial.expensesUgx],
                ["Profit", financial.profitUgx],
                ["Customer debt", financial.customerDebtUgx],
                ["Supplier balance", financial.supplierBalanceUgx],
                ["Cash position", financial.cashPositionUgx],
              ] as const
            ).map(([label, val]) => (
              <div key={label} className="rounded-xl bg-muted px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
                <p className={clsx("mt-0.5 text-sm font-black text-foreground", KPI_VALUE_CLASS)}>{fmtUgx(val)}</p>
              </div>
            ))}
          </div>
          {financial.note ? <p className="mt-2 text-xs text-muted-foreground">{financial.note}</p> : null}
        </RescueSection>
      ) : null}
    </div>
  );
}
