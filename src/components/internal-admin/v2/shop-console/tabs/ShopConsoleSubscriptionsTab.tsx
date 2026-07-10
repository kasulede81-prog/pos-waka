import { useEffect, useMemo } from "react";
import clsx from "clsx";
import { AdminCollapsible } from "../../../adminUi";
import { PromotionalAccessPanel } from "../../PromotionalAccessPanel";
import { RescueSection } from "../../../rescue/RescuePrimitives";
import { adminKpiGridClass, KPI_VALUE_CLASS } from "../../../../../lib/desktopLayout";
import {
  buildRescueFinancialSnapshot,
  computeCloudBackupFinancial,
} from "../../../../../lib/rescueConsoleIntel";
import { t } from "../../../../../lib/i18n";
import type { AdminPlanCode } from "../../../../../lib/wakaInternalAdmin";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = {
  ctx: ShopConsoleState;
  planControlCode: AdminPlanCode;
  setPlanControlCode: (code: AdminPlanCode) => void;
  planControlDays: number;
  setPlanControlDays: (days: number) => void;
  onApplyPlan: () => void;
};

function fmtUgx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

export function ShopConsoleSubscriptionsTab({
  ctx,
  planControlCode,
  setPlanControlCode,
  planControlDays,
  setPlanControlDays,
  onApplyPlan,
}: Props) {
  const { lang, detail, canSubs, busy, previewMode, rescue, loadRescueData } = ctx;

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
      <AdminCollapsible
        title={t(lang, "internalShopProfilePlanControlTitle")}
        summary={`${detail.plan_code ?? detail.subscription?.plan_code ?? "free"} · ${planControlDays}d`}
      >
        <p className="mb-3 text-xs text-stone-600">{t(lang, "internalShopProfilePlanControlSub")}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
            {t(lang, "internalShopProfilePlanSelect")}
            <select
              value={planControlCode}
              onChange={(e) => setPlanControlCode(e.target.value as AdminPlanCode)}
              disabled={!canSubs || busy}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-waka-200 disabled:opacity-50"
            >
              <option value="free">{t(lang, "planFreeName")}</option>
              <option value="starter">{t(lang, "planStarterName")}</option>
              <option value="business">{t(lang, "planBusinessName")}</option>
              <option value="waka_plus">{t(lang, "planWakaPlusName")}</option>
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
            {t(lang, "internalShopProfilePlanDays")}
            <input
              type="number"
              min={1}
              max={3650}
              value={planControlDays}
              onChange={(e) => setPlanControlDays(Math.max(1, Number(e.target.value) || 30))}
              disabled={!canSubs || busy || planControlCode === "free" || planControlCode === "waka_plus"}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-black text-stone-900 outline-none focus:ring-2 focus:ring-waka-200 disabled:opacity-50"
            />
          </label>
        </div>
        {planControlCode === "waka_plus" ? (
          <p className="mt-2 text-xs font-semibold text-emerald-800">VIP is always granted for 30 days.</p>
        ) : null}
        <button
          type="button"
          disabled={busy || !canSubs}
          className="mt-3 min-h-[44px] w-full rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-40"
          onClick={onApplyPlan}
        >
          {t(lang, "internalShopProfileApplyPlan")}
        </button>
        {!canSubs ? (
          <p className="mt-2 text-xs font-semibold text-stone-500">{t(lang, "internalShopProfilePlanNoPermission")}</p>
        ) : null}
      </AdminCollapsible>

      <AdminCollapsible title="Promotional access" summary="Growth campaign grants">
        <PromotionalAccessPanel shopId={detail.shop.id} canManage={canSubs} previewMode={previewMode} />
      </AdminCollapsible>

      {detail.subscriptionPaymentsRecent.length > 0 ? (
        <AdminCollapsible
          title={t(lang, "internalShopProfilePaymentsTitle")}
          summary={`${detail.subscriptionPaymentsRecent.length} recent`}
        >
          <ul className="space-y-2 text-sm">
            {detail.subscriptionPaymentsRecent.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 ring-1 ring-stone-100">
                <span className="font-mono text-[10px] text-stone-600">
                  {new Date(p.created_at).toLocaleString("en-GB")}
                </span>
                <span className="text-xs font-black text-stone-900">
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
              <div key={label} className="rounded-xl bg-stone-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase text-stone-500">{label}</p>
                <p className={clsx("mt-0.5 text-sm font-black text-stone-900", KPI_VALUE_CLASS)}>{fmtUgx(val)}</p>
              </div>
            ))}
          </div>
          {financial.note ? <p className="mt-2 text-xs text-stone-500">{financial.note}</p> : null}
        </RescueSection>
      ) : null}
    </div>
  );
}
